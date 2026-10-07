// A conservative colour suggestion, not a trained stamp-identification model.
// Feed a close crop of one actual stamp. Every result needs human confirmation.
export function suggestSymbol(data) {
  const counts={blue:0,brown:0,pink:0,yellow:0,black:0,red:0,green:0};
  let usable=0;
  for(let i=0;i<data.length;i+=4) {
    const r=data[i]/255,g=data[i+1]/255,b=data[i+2]/255;
    const max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;
    if(max<.28) {counts.black++;usable++;continue;}
    if(delta<.13 || max<.22) continue;
    let hue=max===r?((g-b)/delta)%6:max===g?(b-r)/delta+2:(r-g)/delta+4;
    hue=(hue*60+360)%360;usable++;
    if(hue>=170&&hue<=245) counts.blue++;
    else if(hue>=280&&hue<=345) counts.pink++;
    else if(hue>=30&&hue<=75&&max>.60) counts.yellow++;
    else if(hue>=6&&hue<50&&max<=.65) counts.brown++;
    else if(hue>=75&&hue<170) counts.green++;
    else if(hue<30||hue>345) counts.red++;
  }
  const total=data.length/4;
  const f=k=>counts[k]/total;
  if(usable/total<.025) return {symbol:null,message:'No clear colours found. Move closer in good light, or choose the symbol yourself.'};
  const visible=k=>f(k)>.015;
  if(['red','green','blue','yellow'].every(visible)) return {symbol:'rainbow',message:'These colours look like a rainbow. Check the actual stamp below.'};
  const candidates=[['blueBrown','blue','brown'],['bluePink','blue','pink'],['yellowBlack','yellow','black']].map(([symbol,a,b])=>({symbol,score:Math.min(f(a),f(b)),valid:visible(a)&&visible(b)})).filter(x=>x.valid).sort((a,b)=>b.score-a.score);
  if(!candidates.length || (candidates[1]&&candidates[0].score<candidates[1].score*1.35)) return {symbol:null,message:'The colours are unclear. Choose the matching symbol, or retake the photo.'};
  return {symbol:candidates[0].symbol,message:'Colour suggestion only. Confirm it matches the stamp before adding points.'};
}
