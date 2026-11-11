import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOnlineServer } from '../server/online-server.ts';
import { decodeOnline, idleInput, ONLINE_VERSION, type OnlineSnapshot, type RoomTicket } from '../src/online-protocol.ts';
import { OnlineClient } from '../src/online-client.ts';

async function listen(service:Awaited<ReturnType<typeof createOnlineServer>>):Promise<string>{
  await new Promise<void>(done=>service.server.listen(0,'127.0.0.1',done));
  const address=service.server.address();assert.ok(address&&typeof address!=='string');return `http://127.0.0.1:${address.port}`;
}
async function post(base:string,path:string,value:unknown,token?:string){
  return fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(value),signal:AbortSignal.timeout(5000)});
}
async function stream(base:string,ticket:RoomTicket){
  const abort=new AbortController();
  const response=await fetch(`${base}/api/rooms/${ticket.room}/events`,{headers:{Authorization:`Bearer ${ticket.token}`},signal:abort.signal});
  assert.equal(response.status,200);
  const reader=response.body!.getReader();let buffer='';const decoder=new TextDecoder();
  return {abort,async next():Promise<OnlineSnapshot>{
    const deadline=setTimeout(()=>abort.abort(),5000);
    try{for(;;){
      let end:number;
      while((end=buffer.indexOf('\n\n'))>=0){const message=buffer.slice(0,end);buffer=buffer.slice(end+2);const data=message.split('\n').find(line=>line.startsWith('data: '));if(data)return decodeOnline<OnlineSnapshot>(data.slice(6));}
      const value=await reader.read();assert.equal(value.done,false);buffer+=decoder.decode(value.value,{stream:true});
    }}finally{clearTimeout(deadline);}
  },async close(){abort.abort();await reader.cancel().catch(()=>{});}};
}
test('two HTTP clients join one private room, receive authoritative movement, reconnect and restore after a server restart',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'evergrow-online-'));
  let service=await createOnlineServer({dataDir:directory}),base=await listen(service);
  let first:Awaited<ReturnType<typeof stream>>|undefined,second:Awaited<ReturnType<typeof stream>>|undefined;
  try{
    const creation=await post(base,'/api/rooms',{version:ONLINE_VERSION,name:'Alice',loadout:'sword',seed:7319});
    assert.equal(creation.status,201);const alice=await creation.json() as RoomTicket;
    const roomPath=`/api/rooms/${alice.room}`;
    assert.equal((await post(base,roomPath+'/join',{version:ONLINE_VERSION,name:'Bob',loadout:'bow',invite:'wrong'})).status,403);
    const joined=await post(base,roomPath+'/join',{version:ONLINE_VERSION,name:'Bob',loadout:'bow',invite:alice.invite});
    assert.equal(joined.status,201);const bob=await joined.json() as RoomTicket;
    assert.equal((await post(base,roomPath+'/input',{sequence:1,input:idleInput()},'invalid')).status,401);
    assert.equal((await post(base,roomPath+'/input',{sequence:1,input:{...idleInput(),moveX:999}},alice.token)).status,400);
    first=await stream(base,alice);second=await stream(base,bob);
    const start=await first.next();assert.equal(start.players.length,2);
    const aliceBefore=start.players.find(member=>member.id===alice.player)!.player;
    for(let i=1;i<=6;i++){
      const sent=await post(base,roomPath+'/input',{sequence:i,input:{...idleInput(),moveY:1}},alice.token);assert.equal(sent.status,200);
      await second.next();
    }
    let frame=await second.next();
    const aliceAfter=frame.players.find(member=>member.id===alice.player)!.player;
    assert.ok(aliceAfter.y>aliceBefore.y);
    assert.equal(frame.players.find(member=>member.id===bob.player)!.player.y,0);
    const invalid=await post(base,roomPath+'/command',{type:'setGold',gold:1e9},alice.token);assert.equal(invalid.status,400);
    const room=service.rooms.get(alice.room)!;
    room.authenticate(alice.token)!.sim.player.character.gold=77;
    const idBefore=room.authenticate(alice.token)!.id;
    await first.close();first=await stream(base,alice);frame=await first.next();
    assert.equal(frame.self,idBefore);assert.equal(frame.players.length,2);
    await first.close();first=undefined;await second.close();second=undefined;
    await service.close();
    service=await createOnlineServer({dataDir:directory});base=await listen(service);
    first=await stream(base,alice);frame=await first.next();
    assert.equal(frame.players.find(member=>member.id===alice.player)!.player.character.gold,77);
    assert.equal(frame.players.length,2);
    const intruder=await fetch(base+roomPath+'/events',{headers:{Origin:'https://unrelated.example',Authorization:`Bearer ${alice.token}`}});assert.equal(intruder.status,403);
    const leave=await post(base,roomPath+'/leave',{},bob.token);assert.equal(leave.status,200);
    assert.equal((await post(base,roomPath+'/command',{type:'revive'},bob.token)).status,401);
  }finally{
    await first?.close();await second?.close();await service.close();
    await rm(directory,{recursive:true,force:true});
  }
});
test('the browser transport receives shared state and yields a duplicated session without a reconnect loop',async()=>{
  const service=await createOnlineServer(),base=await listen(service),nativeFetch=globalThis.fetch;
  const clients:OnlineClient[]=[];
  globalThis.fetch=(input,init)=>nativeFetch(typeof input==='string'&&input.startsWith('/')?base+input:input,init);
  const until=async(condition:()=>boolean)=>{
    const started=performance.now();while(!condition()){
      if(performance.now()-started>5000)throw new Error('Timed out waiting for browser transport state.');
      await new Promise(done=>setTimeout(done,10));
    }
  };
  try{
    const a=await(await post(base,'/api/rooms',{version:ONLINE_VERSION,name:'Alice',loadout:'sword',seed:7319})).json() as RoomTicket;
    const b=await(await post(base,`/api/rooms/${a.room}/join`,{version:ONLINE_VERSION,name:'Bob',loadout:'bow',invite:a.invite})).json() as RoomTicket;
    let first:OnlineSnapshot|undefined,second:OnlineSnapshot|undefined,replacement:OnlineSnapshot|undefined,replaced=false;
    const alice=new OnlineClient(a,frame=>{first=frame;},message=>{if(message.includes('outra aba'))replaced=true;});
    const bob=new OnlineClient(b,frame=>{second=frame;},()=>{});clients.push(alice,bob);alice.connect();bob.connect();
    await until(()=>!!first&&!!second);
    assert.equal(first!.players.length,2);
    assert.equal(typeof first!.chart,'string');assert.equal(typeof second!.chart,'string');
    await alice.post('input',{sequence:1,input:{...idleInput(),moveY:1}});
    await until(()=>!!second?.players.some(member=>member.id===a.player&&member.player.y>0));
    assert.ok(second!.players.every(member=>member.player.attack===null||member.player.attack.hitIds instanceof Set));
    const newer=new OnlineClient(a,frame=>{replacement=frame;},()=>{});clients.push(newer);newer.connect();
    await until(()=>replaced&&!!replacement);
    assert.equal(replacement!.self,a.player);assert.equal(replacement!.players.length,2);
    assert.equal(service.rooms.get(a.room)!.members.size,2);
  }finally{for(const client of clients)client.dispose();globalThis.fetch=nativeFetch;await service.close();}
});
