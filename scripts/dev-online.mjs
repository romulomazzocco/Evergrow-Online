import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)),'game');
const children=[
  spawn(process.execPath,['--experimental-strip-types','server/online-server.ts'],{cwd:root,stdio:'inherit'}),
  spawn(process.execPath,['node_modules/vite/bin/vite.js'],{cwd:root,stdio:'inherit'}),
];
let closing=false;
function stop(code=0){
  if(closing)return;closing=true;process.exitCode=code;
  for(const child of children)if(child.exitCode===null)child.kill('SIGTERM');
}
for(const child of children){child.on('error',error=>{console.error(error.message);stop(1);});child.on('exit',code=>stop(code??0));}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
