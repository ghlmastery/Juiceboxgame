import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreFlaps, SYMBOLS } from '../game.mjs';
import { suggestSymbol } from '../public/recognition.js';
test('scores the complete symbol matrix, including doubles as 100 total',()=>{
  for(const [a,sa] of Object.entries(SYMBOLS)) {
    assert.equal(scoreFlaps([a]).points,sa.points);
    for(const [b,sb] of Object.entries(SYMBOLS))assert.deepEqual(scoreFlaps([a,b]),{points:a===b?100:sa.points+sb.points,double:a===b});
  }
  for(const input of [[],['fake'],['rainbow','fake'],['rainbow','rainbow','rainbow'],null,['toString']])assert.throws(()=>scoreFlaps(input));
});
test('colour suggestion abstains on blank images and proposes clear pairs',()=>{
  const pixels=(colours)=>new Uint8ClampedArray(colours.flatMap(c=>Array.from({length:100},()=>[...c,255]).flat()));
  assert.equal(suggestSymbol(pixels([[255,255,255]])).symbol,null);
  assert.equal(suggestSymbol(pixels([[0,180,220],[230,50,170]])).symbol,'bluePink');
  assert.equal(suggestSymbol(pixels([[240,210,10],[15,15,15]])).symbol,'yellowBlack');
});
