import { suggestSymbol } from './recognition.js';
const $=id=>document.getElementById(id);
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const symbols={rainbow:{name:'Rainbow',points:2},blueBrown:{name:'Blue & brown',points:1},bluePink:{name:'Blue & pink',points:1},yellowBlack:{name:'Yellow & black',points:1}};
let state={players:[],history:[],rewards:[],redemptions:[]},active=localStorage.getItem('juice-player')||'',loaded=false;
let stream=null, flaps=[], boxPlayer=null, photoHash=null, selected=null, pendingClaim=null, busy=false, generation=0, objectURL=null;
let rewardRequest=null,toastTimer;
function icon(key) {
  const colours={blueBrown:['#05b3cc','#614133'],bluePink:['#05b3cc','#ee48a7'],yellowBlack:['#eac20a','#242524']};
  return `<span class="symbol-icon" aria-hidden="true">${key==='rainbow'?'🌈':colours[key].map(c=>`<i class="colour-${c.slice(1)}"></i>`).join('')}</span>`;
}
// CSP keeps scripts external; dynamic colours are assigned through DOM style below.
function installIcons(container) {
  container.querySelectorAll('i[style]').forEach(el=>{const c=el.getAttribute('style').split(':')[1];el.removeAttribute('style');el.style.setProperty('--colour',c);});
}
function notify(message,celebrate=false) { clearTimeout(toastTimer);$('toast').textContent=message;$('toast').classList.toggle('celebrate',celebrate);$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,6000); }
async function api(path,payload) {
  let res;
  try {res=await fetch('/api/'+path,{method:payload?'POST':'GET',headers:payload?{'Content-Type':'application/json'}:{},body:payload?JSON.stringify(payload):undefined});}
  catch {throw new Error('Could not connect. Your selection is still here. Please try again.');}
  let result;try {result=await res.json();}catch {throw new Error('The game could not respond. Please try again.');}
  if(!res.ok) {const e=new Error(result.error||'Could not save. Try again.');e.status=res.status;if(res.status===401 && !$('login-dialog').open)$('login-dialog').showModal();throw e;}
  return result;
}
function currentPlayer() {return state.players.find(p=>p.id===active);}
function choosePlayer(id) {active=id;localStorage.setItem('juice-player',id);render();}
function render() {
  if(!state.players.some(p=>p.id===active))active=state.players[0]?.id||'';
  $('player').innerHTML=state.players.length?state.players.map(p=>`<option value="${escape(p.id)}">${escape(p.name)}</option>`).join(''):'<option value="">Add your first player</option>';
  $('player').value=active;$('player').disabled=busy||!!boxPlayer;
  const p=currentPlayer();$('points').textContent=p?.points??'0';$('points-name').textContent=p?`${p.name.toUpperCase()}'S POINTS`:'YOUR POINTS';
  const next=state.rewards.find(r=>r.cost>(p?.points||0));
  $('next-label').textContent=p?(next?next.name:'Ready to redeem!'):'Start your juice crew';
  $('next-detail').textContent=p?(next?`${next.cost-p.points} more points to go`:'Pick a treat in Rewards'):'Add a player to collect points';
  $('reward-balance').textContent=p?.points||0;
  $('reward-grid').innerHTML=state.rewards.map(r=>`<article class="reward-card"><span class="reward-icon" aria-hidden="true">${r.icon}</span><h3>${escape(r.name)}</h3><strong>${r.cost.toLocaleString()} pts</strong><p class="muted">${p&&p.points>=r.cost?'Ready to request':`${Math.max(0,r.cost-(p?.points||0)).toLocaleString()} points to go`}</p><button class="secondary" data-reward="${r.id}" ${!p||p.points<r.cost?'disabled':''}>Request reward</button></article>`).join('');
  const requests=state.redemptions.filter(r=>r.player_id===active);
  $('reward-requests').innerHTML=requests.length?requests.map(r=>`<div class="activity-row"><span aria-hidden="true">🎁</span><div><b>${escape(state.rewards.find(x=>x.id===r.reward_id)?.name||r.reward_id)}</b><small>Requested · ${escape(date(r.created_at))} · Ask a grown-up</small></div><strong>−${r.cost} pts</strong></div>`).join(''):'<p class="empty">No rewards requested yet. Your next treat is waiting.</p>';
  $('family-list').innerHTML=state.players.length?state.players.map(p=>`<article class="player-card"><span class="avatar">${escape([...p.name][0].toUpperCase())}</span><h3>${escape(p.name)}</h3><strong>${p.points.toLocaleString()} <small>pts</small></strong><button class="secondary" data-player="${escape(p.id)}" ${boxPlayer?'disabled':''}>${p.id===active?'Playing now':'Play as '+escape(p.name)}</button></article>`).join(''):'<p class="empty">Every game starts with a player. Add your family’s nicknames to begin.</p>';
  const history=state.history.filter(h=>h.player_id===active);
  $('history-list').innerHTML=history.length?history.map(h=>`<div class="activity-row"><span aria-hidden="true">${h.kind==='scan'?'✦':'🎁'}</span><div><b>${escape(h.label)}</b><small>${escape(h.name)} · ${escape(date(h.created_at))}</small></div><strong class="${h.points>0?'positive':''}">${h.points>0?'+':'−'}${Math.abs(h.points)} pts</strong></div>`).join(''):'<p class="empty">Nothing collected yet. Your first flap starts the story.</p>';
  $('start-camera').disabled=!p||!loaded||busy;$('manual').disabled=!p||!loaded||busy;$('upload').disabled=!p||!loaded||busy;
}
function date(s) {return new Date(s.replace(' ','T')+'Z').toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});}
async function load() {try {state=await api('state');loaded=true;$('load-error').hidden=true;render();}catch(e){$('load-error').hidden=false;$('load-error').querySelector('span').textContent=e.message;render();}}
function stopCamera() {generation++;if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;$('camera').srcObject=null;$('camera').hidden=true;$('reticle').hidden=true;$('capture').hidden=true;$('stop-camera').hidden=true;$('start-camera').hidden=false;$('camera-idle').hidden=!$('photo').hidden;}
function lockPlayer() {if(!boxPlayer)boxPlayer=active;render();}
async function startCamera() {
  if(!currentPlayer())return notify('Add a player first.');
  if(!isSecureContext || !navigator.mediaDevices?.getUserMedia) { $('camera-status').textContent='Live camera needs a secure HTTPS connection. Use a photo or choose the symbol below.';return;}
  stopCamera();clearPhoto();$('camera-status').textContent='Opening camera…';$('start-camera').disabled=true;
  const ticket=generation;
  try {
    const nextStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
    if(ticket!==generation){nextStream.getTracks().forEach(t=>t.stop());return;}
    stream=nextStream;$('camera').srcObject=stream;await $('camera').play();
    $('camera').hidden=false;$('camera-idle').hidden=true;$('reticle').hidden=false;$('start-camera').hidden=true;$('capture').hidden=false;$('stop-camera').hidden=false;
    $('camera-status').textContent='Hold one stamp inside the square. Keep the flap flat and well lit.';
  }catch(e){stopCamera();$('camera-status').textContent=e.name==='NotAllowedError'?'Camera permission was denied. Allow it in your browser, or use a photo.':'Could not open the camera. Use a photo instead.';}
  finally{$('start-camera').disabled=!currentPlayer();}
}
function clearPhoto(){if(objectURL)URL.revokeObjectURL(objectURL);objectURL=null;$('photo').removeAttribute('src');$('photo').hidden=true;$('camera-idle').hidden=!!stream;photoHash=null;}
async function hash(bytes){const d=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('');}
function canvasFor(source,w,h,size) {const c=document.createElement('canvas');c.width=256;c.height=256;c.getContext('2d',{willReadFrequently:true}).drawImage(source,(w-size)/2,(h-size)/2,size,size,0,0,256,256);return c;}
function showReview(suggestion={symbol:null,message:'Choose the colours printed on this flap.'}) {
  lockPlayer();selected=suggestion.symbol;$('review').hidden=false;$('box-review').hidden=true;
  document.querySelector('.scanner-actions').hidden=true;document.querySelector('.fallback-actions').hidden=true;
  $('recognition-title').textContent=selected?'Check your symbol':'Which symbol is this?';$('recognition-note').textContent=suggestion.message;
  $('symbol-picker').innerHTML=Object.entries(symbols).map(([key,s])=>`<button class="symbol-choice" data-symbol="${key}" aria-pressed="${selected===key}">${icon(key)}<span>${s.name}</span></button>`).join('');installIcons($('symbol-picker'));
  $('confirm-flap').disabled=!selected;$('review').scrollIntoView({behavior:'smooth',block:'nearest'});
}
async function capture() {
  if(!stream||!$('camera').videoWidth)return notify('Wait for the camera to be ready.');
  $('capture').disabled=true;
  try {
    const v=$('camera'),stage=$('camera-stage');
    const scale=Math.min(stage.clientWidth/v.videoWidth,stage.clientHeight/v.videoHeight);
    const size=Math.min(180/scale,v.videoWidth,v.videoHeight);
    const c=canvasFor(v,v.videoWidth,v.videoHeight,size);
    const blob=await new Promise(resolve=>c.toBlob(resolve,'image/jpeg',.92));
    if(!blob)throw new Error('Could not capture. Try again.');
    const fingerprint=await hash(await blob.arrayBuffer());stopCamera();clearPhoto();photoHash=fingerprint;objectURL=URL.createObjectURL(blob);$('photo').src=objectURL;$('photo').hidden=false;$('camera-idle').hidden=true;
    $('camera-status').textContent='Photo captured. Check the symbol below.';showReview(suggestSymbol(c.getContext('2d').getImageData(0,0,256,256).data));
  }catch(e){notify(e.message);}finally{$('capture').disabled=false;}
}
async function uploadPhoto(file) {
  if(!file)return;if(file.size>20*1024*1024)return notify('Use a photo smaller than 20 MB.');
  stopCamera();clearPhoto();$('camera-status').textContent='Reading photo…';
  try{
    const fingerprint=await hash(await file.arrayBuffer());const img=new Image();objectURL=URL.createObjectURL(file);img.src=objectURL;await img.decode();
    photoHash=fingerprint;$('photo').src=objectURL;$('photo').hidden=false;$('camera-idle').hidden=true;
    const c=canvasFor(img,img.naturalWidth,img.naturalHeight,Math.min(img.naturalWidth,img.naturalHeight)*.8);
    $('camera-status').textContent='Use a close-up of one stamp. Check the suggested symbol.';
    showReview(suggestSymbol(c.getContext('2d').getImageData(0,0,256,256).data));
  }catch {clearPhoto();$('camera-status').textContent='Could not read that photo. Try a JPEG or PNG.';}
}
function estimate(){return flaps.length===2&&flaps[0].symbol===flaps[1].symbol?100:flaps.reduce((sum,f)=>sum+symbols[f.symbol].points,0);}
function boxReview(){
  stopCamera();$('review').hidden=true;$('box-review').hidden=false;document.querySelector('.scanner-actions').hidden=true;document.querySelector('.fallback-actions').hidden=true;
  $('flap-list').innerHTML=flaps.map((f,i)=>`<div class="flap-chip">${icon(f.symbol)}<span>Flap ${i+1}: ${symbols[f.symbol].name}</span><button data-remove="${i}" ${pendingClaim?'disabled':''}>Remove</button></div>`).join('');installIcons($('flap-list'));
  $('box-estimate').textContent=`${estimate()===100?'A double! ':''}${estimate()} points for this box${flaps.length===1?' so far':''}.`;
  $('box-player').textContent='Points will go to '+state.players.find(p=>p.id===boxPlayer)?.name+'.';
  $('scan-second').hidden=flaps.length===2;$('scan-second').disabled=!!pendingClaim||busy;$('discard').disabled=!!pendingClaim||busy;
  $('claim').disabled=busy;$('claim').textContent=busy?'Saving…':pendingClaim?'Retry saving points':flaps.length===1?'Collect this one flap':`Collect ${estimate()} points`;
}
function resetBox(){stopCamera();clearPhoto();flaps=[];boxPlayer=null;selected=null;pendingClaim=null;busy=false;$('review').hidden=true;$('box-review').hidden=true;document.querySelector('.scanner-actions').hidden=false;document.querySelector('.fallback-actions').hidden=false;$('flap-number').textContent='FLAP 1';$('camera-status').textContent='Fresh box? Let’s find the next symbol.';render();}
function nextFlap(){clearPhoto();$('review').hidden=true;$('box-review').hidden=true;document.querySelector('.scanner-actions').hidden=false;document.querySelector('.fallback-actions').hidden=false;$('flap-number').textContent=`FLAP ${flaps.length+1}`;$('camera-status').textContent='Scan the other flap from this same box.';startCamera();}
async function claim(){
  if(busy||!flaps.length)return;busy=true;
  pendingClaim??={id:crypto.randomUUID(),playerId:boxPlayer,flaps:flaps.map(f=>f.symbol),hashes:flaps.filter(f=>f.hash).map(f=>f.hash)};
  boxReview();
  try{const r=await api('claims',pendingClaim);state=r;resetBox();notify(`${r.double?'DOUBLE! ':''}+${r.points} points. Nicely collected!`,true);}
  catch(e){busy=false;if(e.status && e.status!==401)pendingClaim=null;boxReview();notify(e.message);}
}
function addPlayer() {if(boxPlayer)return notify('Finish or cancel this box before adding a player.');$('player-error').textContent='';$('player-name').value='';$('player-dialog').showModal();}
function changeTab(tab){stopCamera();document.querySelectorAll('.view').forEach(v=>v.hidden=v.id!==`${tab}-view`);document.querySelectorAll('[data-tab]').forEach(b=>{if(b.dataset.tab===tab)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});}
$('score-symbols').innerHTML=Object.entries(symbols).map(([k,s])=>`<div class="symbol-row">${icon(k)}<b>${s.name}</b><strong>${s.points} ${s.points===1?'pt':'pts'}</strong></div>`).join('');installIcons($('score-symbols'));
$('start-camera').onclick=startCamera;$('stop-camera').onclick=()=>{stopCamera();$('camera-status').textContent='Camera closed.';};$('capture').onclick=capture;
$('manual').onclick=()=>{stopCamera();clearPhoto();$('camera-status').textContent='Manual entry. Only add a box you haven’t collected before.';showReview();};
$('upload').onchange=e=>{uploadPhoto(e.target.files[0]);e.target.value='';};
$('symbol-picker').onclick=e=>{const b=e.target.closest('[data-symbol]');if(!b)return;selected=b.dataset.symbol;document.querySelectorAll('[data-symbol]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.symbol===selected)));$('confirm-flap').disabled=false;};
$('confirm-flap').onclick=()=>{if(!selected||flaps.length>=2)return;flaps.push({symbol:selected,hash:photoHash});selected=null;photoHash=null;boxReview();};
$('retake').onclick=()=>{if(!flaps.length){boxPlayer=null;render();}nextFlap();};
$('scan-second').onclick=nextFlap;$('claim').onclick=claim;$('discard').onclick=resetBox;
$('flap-list').onclick=e=>{const b=e.target.closest('[data-remove]');if(!b||pendingClaim)return;flaps.splice(Number(b.dataset.remove),1);if(!flaps.length)resetBox();else boxReview();};
$('player').onchange=e=>{if(!boxPlayer)choosePlayer(e.target.value);};$('add-player').onclick=addPlayer;$('family-add').onclick=addPlayer;
$('player-form').onsubmit=async e=>{e.preventDefault();$('save-player').disabled=true;try{const r=await api('players',{name:$('player-name').value});state=r;choosePlayer(r.id);$('player-dialog').close();notify('Welcome to the juice crew!');}catch(e){$('player-error').textContent=e.message;}finally{$('save-player').disabled=false;}};
$('login-dialog').addEventListener('cancel',e=>e.preventDefault());
$('login-form').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{await api('login',{password:$('password').value});$('password').value='';$('login-dialog').close();await load();}catch(e){$('login-error').textContent=e.message;}finally{button.disabled=false;}};
$('help').onclick=()=>$('help-dialog').showModal();document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>changeTab(b.dataset.tab));
$('family-list').onclick=e=>{const b=e.target.closest('[data-player]');if(b&&!boxPlayer){choosePlayer(b.dataset.player);changeTab('scan');}};
$('reward-grid').onclick=e=>{const b=e.target.closest('[data-reward]');if(!b||!currentPlayer())return;const r=state.rewards.find(r=>r.id===b.dataset.reward);rewardRequest={id:crypto.randomUUID(),playerId:active,rewardId:r.id};$('redeem-title').textContent=r.name;$('redeem-detail').textContent=`Spend ${r.cost} of ${currentPlayer().name}’s points to request this reward?`;$('redeem-error').textContent='';$('redeem-dialog').showModal();};
$('confirm-redeem').onclick=async()=>{if(!rewardRequest)return;$('confirm-redeem').disabled=true;try{state=await api('redeem',rewardRequest);render();$('redeem-dialog').close();rewardRequest=null;notify('Reward requested! Ask a grown-up for your treat.');}catch(e){$('redeem-error').textContent=e.message;}finally{$('confirm-redeem').disabled=false;}};
$('retry-load').onclick=load;
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopCamera();});window.addEventListener('pagehide',stopCamera);
load();
