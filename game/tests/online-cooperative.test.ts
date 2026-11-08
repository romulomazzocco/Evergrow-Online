import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, FIXED_STEP } from '../src/simulation.ts';
import { idleInput, validInput, encodeOnline, decodeOnline } from '../src/online-protocol.ts';
import { OnlineRoom } from '../server/online-room.ts';
import { isSpawnHidden } from '../src/spawn-visibility.ts';
import type { WorldQuery } from '../src/model.ts';
import { createCharacterSheet } from '../src/items.ts';
import { refreshCharacter } from '../src/character.ts';
import { buildingNPC } from '../src/npcs.ts';
import { quoteService } from '../src/commerce.ts';
import { generateItem } from '../src/items.ts';

const flat: WorldQuery = { seed:7319, blocked:()=>false, move:(x,y,dx,dy)=>({x:x+dx,y:y+dy}) };
function party(){
  const hub=new Simulation(flat,{spawn:false}),a=new Simulation(flat,{spawn:false}),b=new Simulation(flat,{spawn:false});
  return {hub,a,b,tick:(attackA=false,attackB=false)=>hub.updateCooperative([{sim:a,input:{...idleInput(),aimX:100,attack:attackA}},{sim:b,input:{...idleInput(),aimX:100,attack:attackB}}])};
}
test('two players move independently at the single-player speed and world clocks advance once',()=>{
  const {hub,a,b}=party(),solo=new Simulation(flat,{spawn:false});
  const right={...idleInput(),moveX:1},down={...idleInput(),moveY:1};
  for(let i=0;i<120;i++){hub.updateCooperative([{sim:a,input:right},{sim:b,input:down}]);solo.update(FIXED_STEP,right);}
  assert.ok(Math.abs(a.player.x-solo.player.x)<1e-7);
  assert.ok(Math.abs(b.player.y-solo.player.x)<1e-7);
  assert.equal(a.player.y,0);assert.equal(b.player.x,0);
  assert.ok(Math.abs(hub.time-1)<1e-7);
});
test('simultaneous melee contacts kill once, share XP and create one set of drops',()=>{
  const {hub,a,b,tick}=party();
  const enemy=hub.spawnEnemy('stalker',40,0)!;enemy.hp=1;enemy.maxHp=1;
  for(let i=0;i<100;i++)tick(true,true);
  assert.equal(enemy.state,'dead');assert.equal(a.kills+b.kills,1);
  assert.ok(a.player.xp>0||a.player.level>1);assert.equal(a.player.xp,b.player.xp);
  const events=[...a.drainEvents(),...b.drainEvents(),...hub.drainEvents()];
  assert.equal(events.filter(event=>event.type==='kill').length,1);
  assert.equal(events.filter(event=>event.type==='experience').length,2);
  const ids=[...hub.groundItems,...hub.groundGold,...hub.pickups].map(drop=>drop.id);
  assert.equal(new Set(ids).size,ids.length);
});
test('nearest player takes enemy melee damage and friendly weapons never hurt allies',()=>{
  const {hub,a,b,tick}=party();a.player.x=-1000;b.player.x=0;
  hub.spawnEnemy('stalker',30,0);
  const beforeA=a.player.hp,beforeB=b.player.hp;
  for(let i=0;i<360;i++)tick();
  assert.equal(a.player.hp,beforeA);assert.ok(b.player.hp<beforeB);
  const friendly=party();friendly.b.player.x=35;
  for(let i=0;i<180;i++)friendly.tick(true,true);
  assert.equal(friendly.a.player.hp,friendly.a.player.maxHp);assert.equal(friendly.b.player.hp,friendly.b.player.maxHp);
});
test('enemy projectiles hit the second player while the first remains out of reach',()=>{
  const {hub,a,b,tick}=party();a.player.x=-1000;b.player.x=200;
  const before=b.player.hp;
  hub.projectiles.push({id:700,sourceLevel:1,x:100,y:0,prevX:100,prevY:0,vx:500,vy:0,angle:0,radius:4,damage:30,life:1,maxLife:1,owner:'enemy',hitIds:new Set()});
  for(let i=0;i<40;i++)tick();
  assert.ok(b.player.hp<before);assert.equal(a.player.hp,a.player.maxHp);assert.equal(hub.projectiles.length,0);
});
test('ranged attacks retain the correct owner, share one enemy pool and unique identities',()=>{
  const {hub,a,b,tick}=party();a.player.x=-1000;
  b.player.character=createCharacterSheet('bow');refreshCharacter(b.player);
  const enemy=hub.spawnEnemy('brute',100,0)!;enemy.hp=1;
  for(let i=0;i<180;i++)tick(false,true);
  assert.equal(enemy.state,'dead');assert.equal(a.kills,0);assert.equal(b.kills,1);
  assert.ok(a.player.xp>0);assert.ok(b.player.xp>0);
});
test('shared coins age once, attract to the nearest player and are credited once',()=>{
  const {hub,a,b,tick}=party();a.player.x=-1000;
  hub.groundGold.push({id:10,x:40,y:0,amount:15,age:0});
  for(let i=0;i<240;i++)tick();
  assert.equal(a.player.character.gold,0);assert.equal(b.player.character.gold,15);assert.equal(hub.groundGold.length,0);
});
test('private room rejects capacity overflow and stale input stops movement',()=>{
  const room=new OnlineRoom(7319),ticket=room.join('Alice','sword');
  const member=room.authenticate(ticket.token)!;
  assert.equal(room.authenticate('wrong-token'),undefined);
  room.join('Bob','bow');room.join('Carol','fire');room.join('Dave','wand');assert.throws(()=>room.join('Eve','sword'),/cheia/);
  member.connected=true;
  room.input(member,{...idleInput(),moveY:1},5,1000);
  assert.equal(room.input(member,{...idleInput(),moveX:1},4,1000),false);
  room.advance(1001);const y=member.sim.player.y;
  for(let i=0;i<120;i++)room.advance(2000+i*9);
  assert.ok(member.sim.player.y-y<2);assert.equal(member.input.moveX,0);assert.equal(member.input.moveY,0);
  room.dispose();
});
test('save and restore retain world loot, individual progress and reconnect credentials',()=>{
  const room=new OnlineRoom(7319),ticket=room.join('Alice','sword'),other=room.join('Bob','bow');
  const alice=room.authenticate(ticket.token)!,bob=room.authenticate(other.token)!;
  alice.sim.player.character.gold=91;bob.sim.player.character.gold=37;
  room.sim.groundGold.push({id:123,x:100,y:100,amount:30,age:1});
  const saved=JSON.parse(JSON.stringify(room.save()));
  const loaded=OnlineRoom.restore(saved);
  assert.equal(loaded.authenticate(ticket.token)!.id,ticket.player);
  assert.equal(loaded.authenticate(ticket.token)!.sim.player.character.gold,91);
  assert.equal(loaded.authenticate(other.token)!.sim.player.character.gold,37);
  assert.equal(loaded.sim.groundGold[0].amount,30);assert.equal(loaded.authenticate(ticket.token)!.connected,false);
  room.dispose();loaded.dispose();
});
test('input validation strips extra state and refuses invalid movement, skills and non-finite numbers',()=>{
  assert.equal(validInput({...idleInput(),moveX:2}),null);
  assert.equal(validInput({...idleInput(),aimX:Infinity}),null);
  assert.equal(validInput({...idleInput(),skillSlot:7}),null);
  assert.equal(validInput({...idleInput(),heldSkillSlots:[0,6]}),null);
  const input=validInput({...idleInput(),hp:999999,character:{gold:1000000}})!;
  assert.equal('hp' in input,false);assert.equal('character' in input,false);
  assert.deepEqual(decodeOnline(encodeOnline({hitIds:new Set([1,2])})),{hitIds:new Set([1,2])});
});
test('spawn exclusion covers every connected camera without excluding the empty space between players',()=>{
  const view={x:0,y:0,width:500,height:400,others:[{x:5000,y:0,width:500,height:400}]};
  assert.equal(isSpawnHidden(200,200,view),false);assert.equal(isSpawnHidden(5200,200,view),false);
  assert.equal(isSpawnHidden(2500,200,view),true);
});
test('town trades recompute prices, enforce proximity and reject replayed quotes',()=>{
  const room=new OnlineRoom(7319),ticket=room.join('Alice','sword'),member=room.authenticate(ticket.token)!;
  const npc=room.world.getBuildings(-2000,-2000,4000,4000).map(buildingNPC).find(npc=>npc?.role==='blacksmith')!;
  assert.ok(npc);Object.assign(member.sim.player,{x:npc.x,y:npc.y});member.sim.player.character.gold=10000;
  const offer=quoteService(member.sim.player.character,npc,1,{type:'buy',slot:0});assert.ok(offer.ok);
  const fake={...offer.quote,price:0};assert.equal(room.command(member,{type:'service',quote:fake}).ok,false);
  assert.equal(member.sim.player.character.gold,10000);
  const bought=room.command(member,{type:'service',quote:offer.quote});assert.equal(bought.ok,true);
  assert.equal(member.sim.player.character.gold,10000-offer.quote.price);
  assert.equal(room.command(member,{type:'service',quote:offer.quote}).ok,false);
  member.sim.player.x+=500;
  const second=quoteService(member.sim.player.character,npc,1,{type:'buy',slot:1});assert.ok(second.ok);
  assert.equal(room.command(member,{type:'service',quote:second.quote}).ok,false);room.dispose();
});
test('two players cannot collect the same transferred item',()=>{
  const room=new OnlineRoom(7319),aTicket=room.join('Alice','sword'),bTicket=room.join('Bob','bow');
  const a=room.authenticate(aTicket.token)!,b=room.authenticate(bTicket.token)!;
  const item=generateItem(792134,1,'ring');a.sim.player.character.inventory[0]=item;
  assert.equal(room.command(a,{type:'drop',source:{type:'bag',index:0,id:'wrong'}}).ok,false);
  assert.equal(room.command(a,{type:'drop',source:{type:'bag',index:0,id:item.id}}).ok,true);
  assert.equal(a.sim.player.character.inventory[0],null);
  const drop=room.sim.groundItems[0];delete drop.flight;
  Object.assign(a.sim.player,{x:drop.x,y:drop.y});Object.assign(b.sim.player,{x:drop.x,y:drop.y});
  a.connected=b.connected=true;a.inputAt=b.inputAt=Date.now();
  assert.equal(room.command(a,{type:'pickup',id:drop.id}).ok,true);assert.equal(room.command(b,{type:'pickup',id:drop.id}).ok,true);
  room.advance();
  assert.equal(room.sim.groundItems.length,0);
  const count=[a,b].flatMap(member=>member.sim.player.character.inventory).filter(entry=>entry?.id===drop.item.id).length;
  assert.equal(count,1);room.dispose();
});
