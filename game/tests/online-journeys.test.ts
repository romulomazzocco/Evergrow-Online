import test from 'node:test';
import assert from 'node:assert/strict';
import { OnlineRoom } from '../server/online-room.ts';
import { OnlineInputBuffer } from '../src/online-input.ts';
import { idleInput, validInput } from '../src/online-protocol.ts';

test('journals use server offers, persist before acceptance and retain independent tracking',async()=>{
  const room=new OnlineRoom(7319),a=room.authenticate(room.join('Alice','sword').token)!,b=room.authenticate(room.join('Bob','bow').token)!;
  a.connected=b.connected=true;
  try{
    for(let i=0;i<12;i++)room.advance();
    const goal=a.sim.journeys.offers.find(goal=>goal.finishedAt===undefined);assert.ok(goal);
    assert.ok(a.sim.journeys.nearestTown);assert.equal(b.sim.journeys.tracked,null);
    assert.equal((await room.worldCommand(a,{type:'journey',command:{type:'accept',id:'forged',x:500,y:500}})).ok,false);
    room.persist=async()=>({ok:false,message:'Disk full'});
    assert.equal((await room.worldCommand(a,{type:'journey',command:{type:'accept',id:goal.id}})).ok,false);
    assert.equal(a.sim.journeys.accepted.length,0);assert.equal(a.sim.journeys.tracked,null);
    room.persist=async()=>({ok:true});
    assert.equal((await room.worldCommand(a,{type:'journey',command:{type:'accept',id:goal.id}})).ok,true);
    assert.equal(a.sim.journeys.tracked,goal.id);assert.equal(b.sim.journeys.accepted.length,0);
    assert.equal((await room.worldCommand(a,{type:'journey',command:{type:'accept',id:goal.id}})).ok,false);
    const restored=OnlineRoom.restore(JSON.parse(JSON.stringify(room.save())));
    try{assert.equal(restored.authenticate(a.token)!.sim.journeys.tracked,goal.id);assert.equal(restored.authenticate(b.token)!.sim.journeys.tracked,null);}finally{restored.dispose();}
    const town=room.surface.getSettlements(-7000,-7000,14000,14000).find(town=>Math.hypot(town.x,town.y)>1000);assert.ok(town);
    Object.assign(a.sim.player,{x:town.x,y:town.y});
    const before=b.sim.player.xp;
    for(let i=0;i<65;i++)room.advance();
    assert.ok(a.sim.journeys.completed?.includes(town.id));assert.equal(b.sim.player.xp,before);
    const xp=a.sim.player.xp,level=a.sim.player.level;
    for(let i=0;i<65;i++)room.advance();
    assert.equal(a.sim.player.xp,xp);assert.equal(a.sim.player.level,level);
  }finally{room.dispose();}
});

test('network input retains brief pad edges once and tracks the latest held controls',async()=>{
  const buffer=new OnlineInputBuffer();
  buffer.push({...idleInput(),moveX:1,attack:true,dodge:true,heal:true,skillSlot:3});
  buffer.push({...idleInput(),moveY:1});
  const first=buffer.consume();assert.equal(first.moveX,0);assert.equal(first.moveY,1);
  assert.equal(first.attack,true);assert.equal(first.dodge,true);assert.equal(first.heal,true);assert.equal(first.skillSlot,3);assert.equal(first.skillPressed,true);
  const second=buffer.consume();assert.equal(second.attack,false);assert.equal(second.dodge,false);assert.equal(second.heal,false);assert.equal(second.skillSlot,null);
  buffer.push({...idleInput(),skillSlot:0,skillPressed:false,heldSkillSlots:[0]});
  assert.equal(buffer.consume().skillPressed,false);
  buffer.push({...idleInput(),dodge:true});buffer.clear();assert.equal(buffer.consume().dodge,false);
  const aimed={...idleInput(),rangedAim:{x:150,y:30}};
  assert.deepEqual(validInput(aimed)?.rangedAim,aimed.rangedAim);
  assert.equal(validInput({...aimed,rangedAim:{x:Infinity,y:0}}),null);
  const room=new OnlineRoom(7319),member=room.authenticate(room.join('Alice','sword').token)!;
  try{
    room.input(member,{...idleInput(),skillSlot:3},1);
    room.input(member,{...idleInput(),skillSlot:0,skillPressed:false},2);
    assert.equal(member.input.skillSlot,3);assert.equal(member.input.skillPressed,true);
    room.command(member,{type:'clearCombat'});assert.equal(member.input.skillSlot,null);
    member.sim.portal.origin={x:member.sim.player.x,y:member.sim.player.y};assert.equal(member.sim.portal.active,true);
    assert.equal((await room.worldCommand(member,{type:'portalCancel'})).ok,true);assert.equal(member.sim.portal.active,false);
  }finally{room.dispose();}
});
