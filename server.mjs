import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REWARDS, SYMBOLS, scoreFlaps } from './game.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
const familyPassword = process.env.FAMILY_PASSWORD || '';
if (!['127.0.0.1', 'localhost', '::1'].includes(host) && familyPassword.length < 12) {
  throw new Error('Set FAMILY_PASSWORD to at least 12 characters before allowing network access.');
}
const dbPath = resolve(process.env.DB_PATH || join(root, 'data/game.sqlite'));
mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS ledger (id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id), points INTEGER NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS claims (id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id), flaps TEXT NOT NULL, points INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS photos (hash TEXT PRIMARY KEY, claim_id TEXT NOT NULL REFERENCES claims(id));
  CREATE INDEX IF NOT EXISTS ledger_player ON ledger(player_id, created_at);
  CREATE TABLE IF NOT EXISTS redemptions (id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id), reward_id TEXT NOT NULL, cost INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'requested', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  PRAGMA optimize;`);
const signingKey = randomBytes(32);
const signature = value => createHmac('sha256', signingKey).update(value).digest('hex');
function equal(a, b) { const aa = Buffer.from(a), bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb); }
function authorized(req) {
  if (!familyPassword) return true;
  const cookie = req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('family='))?.slice(7);
  if (!cookie) return false;
  const [expiry, mac] = cookie.split('.');
  return Number(expiry) > Date.now() && typeof mac === 'string' && equal(mac, signature(expiry));
}
const balance = id => db.prepare('SELECT COALESCE(SUM(points), 0) AS total FROM ledger WHERE player_id=?').get(id).total;
const playerExists = id => typeof id === 'string' && !!db.prepare('SELECT id FROM players WHERE id=?').get(id);
function state() {
  return {
    players: db.prepare('SELECT id, name FROM players ORDER BY created_at, rowid').all().map(p=>({...p, points:balance(p.id)})),
    history: db.prepare('SELECT l.*, p.name FROM ledger l JOIN players p ON p.id=l.player_id ORDER BY l.rowid DESC LIMIT 100').all(),
    redemptions: db.prepare('SELECT r.*, p.name FROM redemptions r JOIN players p ON p.id=r.player_id ORDER BY r.rowid DESC LIMIT 100').all(),
    rewards: REWARDS, symbols: SYMBOLS,
  };
}
function transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const value=fn(); db.exec('COMMIT'); return value; } catch(e) { db.exec('ROLLBACK'); throw e; } }
function json(res, status, body, headers={}) { res.writeHead(status, {'Content-Type':'application/json', 'Cache-Control':'no-store', ...headers}); res.end(JSON.stringify(body)); }
async function body(req) {
  let s=''; for await (const chunk of req) { s+=chunk; if (Buffer.byteLength(s)>20000) throw new Error('Request is too large.'); }
  try { return JSON.parse(s); } catch { throw new Error('Invalid request.'); }
}
const loginAttempts=new Map();
const server=http.createServer(async (req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    const url=new URL(req.url,'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      if (!['GET','POST'].includes(req.method)) return json(res,405,{error:'Method not allowed.'});
      if (req.method==='POST') {
        if (!req.headers['content-type']?.startsWith('application/json')) return json(res,415,{error:'Use JSON.'});
        const origin=req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) return json(res,403,{error:'This request came from another site.'});
      }
      if (url.pathname==='/api/login' && req.method==='POST') {
        const ip=req.socket.remoteAddress;
        const now=Date.now(), old=loginAttempts.get(ip);
        const attempts=old && now-old.start<60000 ? old : {start:now,count:0};
        loginAttempts.set(ip,attempts);
        if (++attempts.count>10) return json(res,429,{error:'Wait a minute before trying again.'});
        const b=await body(req);
        if (typeof b.password!=='string' || !equal(b.password,familyPassword)) return json(res,401,{error:'That family password is incorrect.'});
        const expiry=String(now+7*86400000);
        const secure=req.headers['x-forwarded-proto']==='https';
        return json(res,200,{ok:true},{'Set-Cookie':`family=${expiry}.${signature(expiry)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secure?'; Secure':''}`});
      }
      if (!authorized(req)) return json(res,401,{error:'Enter your family password to play.'});
      if (url.pathname==='/api/state' && req.method==='GET') return json(res,200,state());
      const b=req.method==='POST' ? await body(req) : {};
      if (url.pathname==='/api/players' && req.method==='POST') {
        const name=typeof b.name==='string'?b.name.trim():'';
        if (!name || name.length>30) throw new Error('Use a player name with 1–30 characters.');
        if (db.prepare('SELECT count(*) AS n FROM players').get().n>=30) throw new Error('This family already has 30 players.');
        const id=randomUUID();
        db.prepare('INSERT INTO players(id,name) VALUES (?,?)').run(id,name);
        return json(res,201,{id,...state()});
      }
      if (url.pathname==='/api/claims' && req.method==='POST') {
        if (!playerExists(b.playerId)) throw new Error('Choose a player first.');
        if (typeof b.id!=='string' || !/^[a-f0-9-]{36}$/.test(b.id)) throw new Error('Invalid scan ID.');
        const scored=scoreFlaps(b.flaps);
        if (!Array.isArray(b.hashes) || b.hashes.length>b.flaps.length || b.hashes.some(h=>typeof h!=='string'||!/^[a-f0-9]{64}$/.test(h)) || new Set(b.hashes).size!==b.hashes.length) throw new Error('Use a different photo for each flap.');
        const claim=transaction(()=>{
          const existing=db.prepare('SELECT * FROM claims WHERE id=?').get(b.id);
          if (existing) {
            if (existing.player_id!==b.playerId || existing.flaps!==JSON.stringify(b.flaps)) throw new Error('That scan ID has already been used.');
            return {points:existing.points,double:scored.double};
          }
          for (const h of b.hashes) if (db.prepare('SELECT hash FROM photos WHERE hash=?').get(h)) throw new Error('This exact photo has already earned points. Take a photo of a new box.');
          db.prepare('INSERT INTO claims(id,player_id,flaps,points) VALUES (?,?,?,?)').run(b.id,b.playerId,JSON.stringify(b.flaps),scored.points);
          for (const h of b.hashes) db.prepare('INSERT INTO photos(hash,claim_id) VALUES (?,?)').run(h,b.id);
          const label=(scored.double?'Double! ':'')+b.flaps.map(x=>SYMBOLS[x].name).join(' + ');
          db.prepare('INSERT INTO ledger(id,player_id,points,kind,label) VALUES (?,?,?,?,?)').run(b.id,b.playerId,scored.points,'scan',label);
          return scored;
        });
        return json(res,200,{...claim,...state()});
      }
      if (url.pathname==='/api/redeem' && req.method==='POST') {
        if (!playerExists(b.playerId)) throw new Error('Choose a player first.');
        const reward=REWARDS.find(r=>r.id===b.rewardId);
        if (!reward || typeof b.id!=='string' || !/^[a-f0-9-]{36}$/.test(b.id)) throw new Error('Invalid reward request.');
        transaction(()=>{
          const existing=db.prepare('SELECT * FROM redemptions WHERE id=?').get(b.id);
          if (existing) { if(existing.player_id!==b.playerId || existing.reward_id!==reward.id) throw new Error('That request ID has already been used.'); return; }
          if (balance(b.playerId)<reward.cost) throw new Error('You need more points for this reward.');
          db.prepare('INSERT INTO redemptions(id,player_id,reward_id,cost) VALUES (?,?,?,?)').run(b.id,b.playerId,reward.id,reward.cost);
          db.prepare('INSERT INTO ledger(id,player_id,points,kind,label) VALUES (?,?,?,?,?)').run(b.id,b.playerId,-reward.cost,'reward',reward.name+' · requested');
        });
        return json(res,200,state());
      }
      return json(res,404,{error:'That action could not be found.'});
    }
    if(req.method!=='GET' && req.method!=='HEAD') { res.writeHead(405); return res.end(); }
    const files={'/':'index.html','/app.js':'app.js','/recognition.js':'recognition.js','/styles.css':'styles.css','/rules.jpg':'rules.jpg','/flaps.jpg':'flaps.jpg','/favicon.svg':'favicon.svg'};
    const file=files[url.pathname];
    if(!file) {res.writeHead(404);return res.end('Not found');}
    const mime=file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':file.endsWith('.svg')?'image/svg+xml':'image/jpeg';
    const bytes=readFileSync(join(root,'public',file));
    res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:bytes);
  } catch(e) { json(res,400,{error:e.message.includes('SQLITE')?'Could not save. Please try again.':e.message}); }
});
server.listen(port,host,()=>console.log(`Juice Box Game: http://${host}:${port}\nDatabase: ${dbPath}\n${familyPassword?'Family password protection enabled.':'Local access only. Set FAMILY_PASSWORD and HOST for network access.'}`));
process.on('SIGTERM',()=>server.close(()=>{db.close();process.exit(0);}));
