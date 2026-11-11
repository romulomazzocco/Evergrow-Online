import test from 'node:test';
import assert from 'node:assert/strict';
import { OnlineRoom } from '../server/online-room.ts';
import { hasLineOfSight } from '../src/combat-geometry.ts';
import { refreshCharacter } from '../src/character.ts';
import { currentDungeon } from '../src/dungeon-state.ts';
import { RIFT_RULES } from '../src/rift-content.ts';
import { expeditionTableProblem } from '../src/dungeon-command.ts';

function dungeonParty(){
  const room=new OnlineRoom(7319),a=room.authenticate(room.join('Alice','sword').token)!,b=room.authenticate(room.join('Bob','bow').token)!;
  const entrance=room.surface.getDungeonEntrances(-4000,-4000,8000,8000)[0];assert.ok(entrance);
  let point:{x:number;y:number}|undefined;
  for(let i=0;i<16;i++){
    const candidate={x:entrance.x+Math.cos(i*Math.PI/8)*45,y:entrance.y+Math.sin(i*Math.PI/8)*45};
    if(!room.surface.blocked(candidate.x,candidate.y,a.sim.player.radius)&&hasLineOfSight(room.surface,candidate.x,candidate.y,entrance.x,entrance.y)){point=candidate;break;}
  }
  assert.ok(point);Object.assign(a.sim.player,point);Object.assign(b.sim.player,point);a.connected=b.connected=true;
  return {room,a,b,entrance};
}
test('group dungeon travel preserves personal characters, shared surface loot and monotonically allocated identities',async()=>{
  const {room,a,b,entrance}=dungeonParty();
  try{
    a.sim.player.character.gold=11;b.sim.player.character.gold=22;a.sim.player.hp=35;b.sim.player.hp=56;
    room.sim.groundGold.push({id:300,x:100,y:100,amount:17,age:1});room.sim.reserveIdentity(500);
    const action={type:'dungeon',kind:'enter',id:entrance.id};
    room.persist=async()=>({ok:false,message:'Disk full'});
    assert.equal((await room.worldCommand(a,action)).ok,false);assert.equal(room.sim.expeditions.location,null);assert.equal(room.world,room.surface);
    b.sim.player.x+=500;assert.equal((await room.worldCommand(a,action)).ok,false);b.sim.player.x=a.sim.player.x;
    let saved:ReturnType<OnlineRoom['save']>|undefined;
    room.persist=async()=>{saved=JSON.parse(JSON.stringify(room.save()));return {ok:true};};
    const entered=await room.worldCommand(a,action);assert.equal(entered.ok,true,entered.message);
    assert.equal(room.sim.expeditions.location,entrance.id);assert.notEqual(room.world,room.surface);
    assert.equal(a.sim.world,room.world);assert.equal(b.sim.world,room.world);
    assert.equal(a.sim.player.name,'Alice');assert.equal(b.sim.player.name,'Bob');
    assert.equal(a.sim.player.character.gold,11);assert.equal(b.sim.player.character.gold,22);
    assert.equal(a.sim.player.hp,35);assert.equal(b.sim.player.hp,56);
    assert.equal(room.sim.groundGold.length,0);assert.ok(room.sim.nextEntityIdentity>=500);
    assert.ok(saved);const loaded=OnlineRoom.restore(saved);
    try{
      assert.equal(loaded.sim.expeditions.location,entrance.id);assert.notEqual(loaded.world,loaded.surface);
      assert.equal(loaded.members.get(b.id)!.sim.player.character.gold,22);assert.ok(loaded.sim.nextEntityIdentity>=500);
    }finally{loaded.dispose();}
    const exit=await room.worldCommand(b,{type:'dungeon',kind:'exit'});assert.equal(exit.ok,true,exit.message);
    assert.equal(room.world,room.surface);assert.equal(room.sim.expeditions.location,null);
    assert.equal(room.sim.groundGold.length,1);assert.equal(room.sim.groundGold[0].amount,17);
    assert.equal(a.sim.player.character.gold,11);assert.equal(b.sim.player.character.gold,22);
  }finally{room.dispose();}
});
test('late join and individual revival use the active floor entry without resetting the party world',async()=>{
  const {room,a,entrance}=dungeonParty();
  try{
    const entered=await room.worldCommand(a,{type:'dungeon',kind:'enter',id:entrance.id});assert.equal(entered.ok,true,entered.message);
    const floor=room.sim.dungeonFloor!,c=room.authenticate(room.join('Carol','fire').token)!;
    assert.equal(c.sim.player.x,floor.entry.x);assert.equal(c.sim.player.y,floor.entry.y);
    const location=room.sim.expeditions.location;a.sim.player.hp=0;a.sim.player.dead=true;
    assert.equal(room.command(a,{type:'revive'}).ok,true);
    assert.equal(a.sim.player.x,floor.entry.x);assert.equal(a.sim.player.y,floor.entry.y);assert.equal(a.sim.player.dead,false);
    assert.equal(a.sim.player.name,'Alice');
    assert.equal(room.sim.expeditions.location,location);
  }finally{room.dispose();}
});
test('a cooperative rift keeps one clock and returns the party to the surface on timeout',async()=>{
  const {room,a,b}=dungeonParty();
  try{
    const portal=room.surface.getBuildings(-2000,-2000,4000,4000).find(building=>building.kind==='rift');assert.ok(portal);
    let point:{x:number;y:number}|undefined;
    for(let i=0;i<16;i++){
      const p={x:portal.door.x+Math.cos(i*Math.PI/8)*50,y:portal.door.y+Math.sin(i*Math.PI/8)*50};
      if(!room.surface.blocked(p.x,p.y,a.sim.player.radius)&&hasLineOfSight(room.surface,p.x,p.y,portal.door.x,portal.door.y)){point=p;break;}
    }
    assert.ok(point);Object.assign(a.sim.player,point);Object.assign(b.sim.player,point);
    const action={type:'dungeon',kind:'rift',portalId:portal.id,offset:0,attempt:0};
    assert.equal((await room.worldCommand(a,action)).ok,false);
    a.sim.player.level=b.sim.player.level=20;refreshCharacter(a.sim.player);refreshCharacter(b.sim.player);
    const result=await room.worldCommand(a,action);assert.equal(result.ok,true,result.message);
    const progress=currentDungeon(room.sim.expeditions)!.rift!;assert.equal(progress.elapsed,0);
    const now=Date.now();for(let i=0;i<120;i++)room.advance(now);
    assert.ok(Math.abs(progress.elapsed-1)<1e-6);
    progress.elapsed=RIFT_RULES.duration;room.advance(now+1000);
    for(let i=0;i<20&&room.sim.expeditions.location;i++)await new Promise(done=>setImmediate(done));
    assert.equal(room.sim.expeditions.location,null);assert.equal(room.world,room.surface);
    assert.equal(a.sim.world,room.surface);assert.equal(b.sim.world,room.surface);
  }finally{room.dispose();}
});
test('an expedition resumes the same party route and its wounded boss after returning to town',async()=>{
  const {room,a,b}=dungeonParty();
  try{
    const table=room.surface.getBuildings(-2000,-2000,4000,4000).find(building=>building.kind==='expedition');assert.ok(table);
    let point:{x:number;y:number}|undefined;
    for(let i=0;i<16;i++){
      const p={x:table.door.x+Math.cos(i*Math.PI/8)*55,y:table.door.y+Math.sin(i*Math.PI/8)*55};
      if(!expeditionTableProblem(table,p,room.surface)){point=p;break;}
    }
    assert.ok(point);Object.assign(a.sim.player,point);Object.assign(b.sim.player,point);
    a.sim.player.level=b.sim.player.level=20;refreshCharacter(a.sim.player);refreshCharacter(b.sim.player);
    const entered=await room.worldCommand(a,{type:'dungeon',kind:'expedition',tableId:table.id,choice:0,attempt:0});assert.equal(entered.ok,true,entered.message);
    const run=currentDungeon(room.sim.expeditions)!;assert.ok(run.entrance.expedition);const id=run.entrance.id;
    run.states.warden.hp=12;
    const exited=await room.worldCommand(a,{type:'dungeon',kind:'exit'});assert.equal(exited.ok,true,exited.message);
    const route=room.sim.expeditions.route!;assert.equal(route.attempt,1);
    const resumed=await room.worldCommand(b,{type:'dungeon',kind:'expedition',tableId:table.id,choice:-1,attempt:route.attempt,resume:id});
    assert.equal(resumed.ok,true,resumed.message);assert.equal(room.sim.expeditions.location,id);
    assert.equal(currentDungeon(room.sim.expeditions)!.states.warden.hp,12);
  }finally{room.dispose();}
});
