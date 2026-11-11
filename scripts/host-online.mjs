import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rename, open } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createOnlineProxy } from './online-proxy.mjs';

const root=resolve(fileURLToPath(new URL('..',import.meta.url))),runtime=join(root,'.online-host');
const stateFile=join(runtime,'state.json'),stopFile=join(runtime,'stop.json');
const wait=ms=>new Promise(done=>setTimeout(done,ms));
const read=async file=>{try{return JSON.parse(await readFile(file,'utf8'));}catch{return null;}};
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
const mode=process.argv[2]??'start';
await mkdir(runtime,{recursive:true});

if(mode==='start'){
  let state=await read(stateFile);
  if(!state||state.phase==='stopped'||!alive(state.pid)){
    const output=await open(join(runtime,'host.log'),'a'),error=await open(join(runtime,'host-error.log'),'a');
    const child=spawn(process.execPath,['--experimental-strip-types',fileURLToPath(import.meta.url),'run'],{
      cwd:root,detached:true,windowsHide:true,stdio:['ignore',output.fd,error.fd],
    });
    child.unref();await output.close();await error.close();
    const started=Date.now();
    while(Date.now()-started<30_000){state=await read(stateFile);if(state?.pid===child.pid&&['ready','stopped'].includes(state.phase))break;await wait(250);}
  }
  console.log(state?.phase==='ready'?state.url:'Conectando. Consulte: npm run online:remote:status');
}else if(mode==='status'){
  const state=await read(stateFile);
  console.log(state&&alive(state.pid)?JSON.stringify({phase:state.phase,url:state.url??null,proxy:'http://127.0.0.1:3002'}):'Acesso remoto parado.');
}else if(mode==='stop'){
  const state=await read(stateFile);
  if(state&&alive(state.pid)){
    await writeFile(stopFile,JSON.stringify({id:state.id}));
    for(let attempt=0;attempt<40&&alive(state.pid);attempt++)await wait(250);
    console.log(alive(state.pid)?'Encerramento solicitado. Consulte o status.':'Acesso remoto encerrado.');
  }else console.log('Acesso remoto já está parado.');
}else if(mode==='run'){
  const state={id:randomUUID(),pid:process.pid,phase:'connecting',url:null};
  let publishing=Promise.resolve();
  const publish=()=>{const snapshot=JSON.stringify(state);return publishing=publishing.then(async()=>{await writeFile(stateFile+'.tmp',snapshot);await rename(stateFile+'.tmp',stateFile);});};
  let stopping=false,ssh,ownedBackend,checking=false;
  const proxy=createOnlineProxy(3001);
  const ensureBackend=async()=>{
    if(checking||stopping||ownedBackend)return;checking=true;
    try{
      await fetch('http://127.0.0.1:3001/api/health',{signal:AbortSignal.timeout(2000)});
    }catch(error){
      if(error.cause?.code!=='ECONNREFUSED')throw error;
      const {createOnlineServer}=await import('../game/server/online-server.ts');
      ownedBackend=await createOnlineServer({dataDir:join(root,'game/online-data'),staticDir:join(root,'game/dist')});
      await new Promise((done,reject)=>{ownedBackend.server.once('error',reject);ownedBackend.server.listen(3001,'127.0.0.1',done);});
      console.log('Servidor de produção iniciado pelo host remoto.');
    }finally{checking=false;}
  };
  await publish();
  // Public host key verified against https://serveo.net/docs/ on 2026-11-11.
  await writeFile(join(runtime,'serveo_known_hosts'),'serveo.net ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGX8CMtRKSA58fmA3I6oat6+7Z6VUwGbzYUE5FVrA3g1\n');
  const shutdown=async()=>{
    if(stopping)return;stopping=true;clearInterval(monitor);ssh?.kill();
    proxy.closeAllConnections();await new Promise(done=>proxy.close(done));
    await ownedBackend?.close();state.phase='stopped';await publish();
  };
  const monitor=setInterval(()=>{
    void read(stopFile).then(value=>{if(value?.id===state.id)void shutdown();});
    void ensureBackend().catch(error=>console.error('Servidor local:',error.message));
  },2000);
  process.once('SIGINT',()=>void shutdown());process.once('SIGTERM',()=>void shutdown());
  try{
    await ensureBackend();await new Promise((done,reject)=>{proxy.once('error',reject);proxy.listen(3002,'127.0.0.1',done);});
    while(!stopping){
      state.phase='connecting';await publish();
      await new Promise(done=>{
        ssh=spawn('ssh',['-n','-T','-p','22','-o','ConnectTimeout=15','-o','StrictHostKeyChecking=yes',
          '-o','UserKnownHostsFile=.online-host/serveo_known_hosts','-o','PreferredAuthentications=keyboard-interactive',
          '-o','IdentityFile=none','-o','IdentitiesOnly=yes','-o','ServerAliveInterval=30','-o','ServerAliveCountMax=3',
          '-o','ExitOnForwardFailure=yes','-R','80:127.0.0.1:3002','--','evergrow-online@serveo.net','--https-only'],
          {cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
        let text='';
        ssh.stdout.on('data',chunk=>{
          process.stdout.write(chunk);text=(text+chunk.toString()).slice(-4096);
          const match=text.match(/Forwarding HTTP traffic from (https:\/\/[a-zA-Z0-9.-]+)/);
          if(match&&(state.url!==match[1]||state.phase!=='ready')){
            state.url=match[1];state.phase='ready';void publish().catch(console.error);
          }
        });
        ssh.stderr.on('data',chunk=>process.stderr.write(chunk));
        ssh.once('error',error=>console.error('Serveo:',error.message));ssh.once('close',done);
      });
      if(!stopping)await wait(5000);
    }
  }catch(error){console.error(error);await shutdown();process.exitCode=1;}
}else throw new Error('Use start, status ou stop.');
