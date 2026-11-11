import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, get } from 'node:http';
import { createOnlineProxy } from './online-proxy.mjs';
import { gunzipSync } from 'node:zlib';

const listen=server=>new Promise(done=>server.listen(0,'127.0.0.1',()=>done(server.address().port)));
const close=server=>new Promise(done=>{server.closeAllConnections();server.close(done);});
test('remote proxy compresses full assets, flushes live events and forwards authenticated requests',async()=>{
  const asset='export const sample="Evergrow";\n'.repeat(60_000);let authorization='',origin='',body='';
  const source=createServer((req,res)=>{
    authorization=req.headers.authorization;origin=req.headers.origin;
    if(req.url==='/events'){
      res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: {"tick":1}\n\n');
      const timer=setInterval(()=>res.write('data: {"tick":2}\n\n'),30);res.on('close',()=>clearInterval(timer));return;
    }
    if(req.method==='POST'){req.on('data',chunk=>body+=chunk);req.on('end',()=>{res.setHeader('Content-Type','application/json');res.end(body);});return;}
    res.writeHead(200,{'Content-Type':'text/javascript','Content-Length':Buffer.byteLength(asset)});res.end(asset);
  });
  const proxy=createOnlineProxy(await listen(source)),port=await listen(proxy),base=`http://127.0.0.1:${port}`;
  try{
    const raw=await new Promise((done,reject)=>get(base,{headers:{'Accept-Encoding':'gzip'}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>done({headers:res.headers,bytes:Buffer.concat(chunks)}));res.on('error',reject);
    }).on('error',reject));
    assert.equal(raw.headers['content-encoding'],'gzip');assert.ok(raw.bytes.length<asset.length/10);assert.equal(gunzipSync(raw.bytes).toString(),asset);
    const plain=await fetch(base,{headers:{'Accept-Encoding':'gzip;q=0'}});assert.equal(plain.headers.get('content-encoding'),null);assert.equal(await plain.text(),asset);
    const posted=await fetch(base,{method:'POST',headers:{Authorization:'Bearer synthetic',Origin:'https://synthetic.example','Content-Type':'application/json'},body:'{"action":"test"}'});
    assert.equal(await posted.text(),'{"action":"test"}');assert.equal(authorization,'Bearer synthetic');assert.equal(origin,'https://synthetic.example');
    const abort=new AbortController(),events=await fetch(base+'/events',{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(2000)])});
    assert.equal(events.headers.get('content-encoding'),'gzip');const reader=events.body.getReader();let output='';
    while(!output.includes('"tick":2')){const next=await reader.read();assert.equal(next.done,false);output+=new TextDecoder().decode(next.value);}
    assert.match(output,/"tick":1/);abort.abort();await reader.cancel().catch(()=>{});
  }finally{await close(proxy);await close(source);}
});
