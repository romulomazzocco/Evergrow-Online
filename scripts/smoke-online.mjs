import assert from 'node:assert/strict';

const origin=new URL(process.argv[2]??'http://127.0.0.1:3001');
let healthy=false;
for(let attempt=0;attempt<60;attempt++){
  try{healthy=(await fetch(new URL('/api/health',origin),{signal:AbortSignal.timeout(1000)})).ok;}catch{/* Wait for container startup. */}
  if(healthy)break;await new Promise(done=>setTimeout(done,250));
}
assert.ok(healthy,'Online server did not become healthy');
const page=await fetch(origin);assert.equal(page.status,200);
const html=await page.text();assert.match(html,/Evergrow Online/);
const assets=[...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)/g)].map(match=>match[1]);assert.ok(assets.length);
for(const asset of assets){const response=await fetch(new URL(asset,origin));assert.equal(response.status,200,asset);await response.arrayBuffer();}
const created=await fetch(new URL('/api/rooms',origin),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:1,name:'Container smoke',loadout:'sword',seed:7319})});
assert.equal(created.status,201);const ticket=await created.json();
const joined=await fetch(new URL(`/api/rooms/${ticket.room}/join`,origin),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:1,name:'Partner',loadout:'bow',invite:ticket.invite})});
assert.equal(joined.status,201);const partner=await joined.json();
for(const member of [ticket,partner]){
  const left=await fetch(new URL(`/api/rooms/${ticket.room}/leave`,origin),{method:'POST',headers:{Authorization:`Bearer ${member.token}`,'Content-Type':'application/json'},body:'{}'});assert.equal(left.status,200);
}
console.log('Container health, production assets and two-player room API passed.');
