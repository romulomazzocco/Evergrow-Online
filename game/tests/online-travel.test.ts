import test from 'node:test';
import assert from 'node:assert/strict';
import { OnlineRoom } from '../server/online-room.ts';
import { idleInput } from '../src/online-protocol.ts';
import { eventProblem } from '../src/poi-command.ts';

function travellers(){
  const room=new OnlineRoom(7319),a=room.authenticate(room.join('Alice','sword').token)!,b=room.authenticate(room.join('Bob','bow').token)!;
  a.connected=b.connected=true;room.exploration.reveal(0,0);
  const home=room.surface.getPortalAnchor(0);room.exploration.reveal(home.x,home.y);
  const destination=room.exploration.getDiscoveredPOIs().find(poi=>poi.kind==='town')!;assert.ok(destination);
  let source:{x:number;y:number}|undefined;
  for(let i=0;i<200;i++){
    const point={x:1200+Math.cos(i*2.4)*i*5,y:1200+Math.sin(i*2.4)*i*5};
    if(!room.world.blocked(point.x,point.y,a.sim.player.radius)&&!room.world.isSanctuary(point.x,point.y)){source=point;break;}
  }
  assert.ok(source);Object.assign(a.sim.player,source);
  return {room,a,b,destination,source};
}
test('map travel uses server discoveries, preserves personal resources and restores the shared chart',async()=>{
  const {room,a,b,destination,source}=travellers();
  try{
    a.sim.player.hp=31;a.sim.player.character.gold=75;
    assert.equal((await room.worldCommand(a,{type:'mapTravel',id:'forged-location',x:9999,y:9999})).ok,false);
    assert.equal(a.sim.player.x,source.x);
    room.persist=async()=>({ok:false,message:'Disk full'});
    assert.equal((await room.worldCommand(a,{type:'mapTravel',id:destination.id})).ok,false);assert.equal(a.sim.player.x,source.x);
    room.persist=async()=>({ok:true});
    const result=await room.worldCommand(a,{type:'mapTravel',id:destination.id});assert.equal(result.ok,true,result.message);
    assert.ok(Math.hypot(a.sim.player.x-destination.x,a.sim.player.y-destination.y)<150);
    assert.equal(a.sim.player.hp,31);assert.equal(a.sim.player.character.gold,75);assert.equal(b.sim.player.x,0);
    const restored=OnlineRoom.restore(JSON.parse(JSON.stringify(room.save())));
    try{assert.ok(restored.exploration.getDiscoveredPOI(destination.id));assert.equal(restored.chart(),room.chart());}finally{restored.dispose();}
    const sighted=room.surface.getPOIs(-4000,-4000,8000,8000).find(poi=>!room.exploration.isDiscovered(poi.id));assert.ok(sighted);
    room.exploration.revealFromBeacon(0,0,sighted);
    assert.equal(room.exploration.getDiscoveredPOI(sighted.id)?.sighted,true);
    assert.equal((await room.worldCommand(a,{type:'mapTravel',id:sighted.id})).ok,false);
  }finally{room.dispose();}
});
test('one player leaving an active trial does not interrupt a companion who stays at the objective',async()=>{
  const {room,a,b,destination}=travellers();
  try{
    let selected:ReturnType<typeof room.world.getEventSites>[number]|undefined;
    for(const site of room.world.getEventSites(-4000,-4000,8000,8000).filter(site=>site.kind==='cursedChest'||site.kind==='ruinedChapel')){
      for(let i=0;i<16;i++){
        Object.assign(a.sim.player,{x:site.x+Math.cos(i*Math.PI/8)*50,y:site.y+Math.sin(i*Math.PI/8)*50});
        if(!eventProblem(a.sim,site,null)){selected=site;break;}
      }
      if(selected)break;
    }
    assert.ok(selected);Object.assign(b.sim.player,{x:a.sim.player.x,y:a.sim.player.y});
    assert.equal((await room.worldCommand(a,{type:'event',id:selected.id,choice:null})).ok,true);
    assert.ok(room.sim.eventState.trial);
    assert.equal((await room.worldCommand(a,{type:'mapTravel',id:destination.id})).ok,true);
    assert.equal(room.sim.eventState.sites[selected.id].phase,'active');
    room.advance();assert.ok(room.sim.eventState.trial);assert.equal(room.sim.eventState.sites[selected.id].phase,'active');
  }finally{room.dispose();}
});
test('the three-second town portal returns only its owner and preserves a usable return link',async()=>{
  const {room,a,b,source}=travellers();
  try{
    a.sim.player.hp=31;a.sim.player.character.gold=75;
    const result=await room.worldCommand(a,{type:'portalStart'});assert.equal(result.ok,true,result.message);
    const now=Date.now();
    for(let i=1;i<=400;i++){
      room.input(a,idleInput(),i,now+i*1000/120);room.advance(now+i*1000/120);
      if(i%30===0)await new Promise(done=>setImmediate(done));
    }
    for(let i=0;i<20&&a.sim.portal.ready;i++)await new Promise(done=>setImmediate(done));
    assert.ok(a.sim.travel.returnTo);assert.ok(room.world.isSanctuary(a.sim.player.x,a.sim.player.y));
    assert.equal(a.sim.player.hp,31);assert.equal(a.sim.player.character.gold,75);assert.equal(b.sim.player.x,0);
    const returned=await room.worldCommand(a,{type:'portalReturn'});assert.equal(returned.ok,true,returned.message);
    assert.equal(a.sim.travel.returnTo,null);assert.ok(Math.hypot(a.sim.player.x-source.x,a.sim.player.y-source.y)<80);
  }finally{room.dispose();}
});
