import { createServer, request } from 'node:http';
import { createGzip, constants } from 'node:zlib';
import { pipeline } from 'node:stream';

/** Keep remote compression outside the running game's simulation and save process. */
export function createOnlineProxy(port=3001){
  return createServer((req,res)=>{
    const headers={...req.headers,'accept-encoding':'identity'};
    const upstream=request({host:'127.0.0.1',port,path:req.url,method:req.method,headers},response=>{
      const accepts=(req.headers['accept-encoding']??'').split(',').some(value=>{
        const [name,...parameters]=value.trim().toLowerCase().split(';');
        return name==='gzip'&&!parameters.some(value=>/^q\s*=\s*0(?:\.0*)?$/.test(value.trim()));
      });
      const type=String(response.headers['content-type']??'');
      const compress=req.method!=='HEAD'&&accepts&&!response.headers['content-encoding']
        &&/^(text\/|application\/(javascript|json)|image\/svg\+xml|font\/ttf)/i.test(type);
      const outgoing={...response.headers};delete outgoing['transfer-encoding'];
      if(compress){
        delete outgoing['content-length'];outgoing['content-encoding']='gzip';
        outgoing.vary=[outgoing.vary,'Accept-Encoding'].filter(Boolean).join(', ');
      }
      res.writeHead(response.statusCode??502,outgoing);
      if(compress)pipeline(response,createGzip(type.startsWith('text/event-stream')?{flush:constants.Z_SYNC_FLUSH}:{}),res,()=>{});
      else pipeline(response,res,()=>{});
      res.on('close',()=>response.destroy());
    });
    upstream.on('error',()=>{if(!res.headersSent){res.writeHead(502,{'Content-Type':'application/json'});res.end('{"message":"Servidor local indisponível."}');}else res.destroy();});
    req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());
    req.pipe(upstream);
  });
}
