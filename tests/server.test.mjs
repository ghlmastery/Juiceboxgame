import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
test('server preserves points, requires family login, and safely retries claims and rewards',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'juice-test-'));
  let child,cookie='';const port=3197;
  const start=()=>new Promise((resolve,reject)=>{
    child=spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:String(port),DB_PATH:join(dir,'test.sqlite'),FAMILY_PASSWORD:'family-test-password'}});
    child.stdout.on('data',()=>resolve());child.stderr.on('data',b=>reject(new Error(String(b))));child.on('error',reject);
  });
  const stop=()=>new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');});
  async function api(path,body){const r=await fetch(`http://127.0.0.1:${port}/api/${path}`,{method:body?'POST':'GET',headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json(),headers:r.headers};}
  try{
    await start();assert.equal((await api('state')).status,401);
    assert.equal((await api('login',{password:'wrong'})).status,401);
    const login=await api('login',{password:'family-test-password'});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
    const p=await api('players',{name:'Player one'}),q=await api('players',{name:'Player two'});assert.equal(p.status,201);
    const claim={id:randomUUID(),playerId:p.body.id,flaps:['rainbow','rainbow'],hashes:['a'.repeat(64),'b'.repeat(64)]};
    const results=await Promise.all([api('claims',claim),api('claims',claim)]);assert.ok(results.every(r=>r.status===200));
    let s=(await api('state')).body;assert.equal(s.players.find(x=>x.id===p.body.id).points,100);assert.equal(s.players.find(x=>x.id===q.body.id).points,0);
    assert.equal((await api('claims',{...claim,id:randomUUID()})).status,400);
    assert.equal((await api('claims',{...claim,playerId:q.body.id})).status,400);
    const reward={id:randomUUID(),playerId:p.body.id,rewardId:'juice'};assert.equal((await api('redeem',reward)).status,200);assert.equal((await api('redeem',reward)).status,200);
    assert.equal((await api('redeem',{...reward,id:randomUUID(),rewardId:'cash'})).status,400);
    assert.equal((await api('claims',{id:randomUUID(),playerId:p.body.id,flaps:['fake'],hashes:[]})).status,400);
    s=(await api('state')).body;assert.equal(s.players.find(x=>x.id===p.body.id).points,50);assert.equal(s.redemptions.length,1);
    await stop();await start();cookie='';const relogin=await api('login',{password:'family-test-password'});cookie=relogin.headers.get('set-cookie').split(';')[0];
    s=(await api('state')).body;assert.equal(s.players.find(x=>x.id===p.body.id).points,50);assert.equal(s.history.length,2);
  }finally{if(child&&child.exitCode===null)await stop();await rm(dir,{recursive:true,force:true});}
});
