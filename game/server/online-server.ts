import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { OnlineRoom, equalSecret, type OnlineMember, type SavedRoom } from './online-room.ts';
import { encodeOnline, idleInput, object, ONLINE_LIMITS, ONLINE_VERSION, validInput } from '../src/online-protocol.ts';
import { FIXED_STEP } from '../src/simulation.ts';
import { isWorldSeed } from '../src/world-seed.ts';

interface Options { dataDir?: string; staticDir?: string; origin?: string; }
class HttpError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > ONLINE_LIMITS.body) throw new HttpError(413, 'Pedido muito grande.');
    chunks.push(Buffer.from(chunk));
  }
  try { const result = object(JSON.parse(Buffer.concat(chunks).toString())); if (result) return result; } catch { /* Report one bounded validation error. */ }
  throw new HttpError(400, 'Pedido inválido.');
}
function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
export async function createOnlineServer(options: Options = {}) {
  const rooms = new Map<string, OnlineRoom>();
  const streams = new Map<OnlineMember, ServerResponse>();
  const rates = new Map<string, { at: number; count: number }>();
  let saveError = '', saving: Promise<void> = Promise.resolve();
  if (options.dataDir) {
    await mkdir(options.dataDir, { recursive: true, mode: 0o700 });
    let source: string | undefined;
    try { source = await readFile(resolve(options.dataDir, 'rooms.json'), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (source) {
      const saved = JSON.parse(source) as SavedRoom[];
      if (!Array.isArray(saved) || saved.length > ONLINE_LIMITS.rooms || saved.some(room => room.version !== 1 || !isWorldSeed(room.seed)))
        throw new Error('Unsupported online save. Preserve rooms.json before changing server versions.');
      for (const entry of saved) { const room = OnlineRoom.restore(entry); rooms.set(room.id, room); }
    }
  }
  function limit(key: string, maximum: number, window: number): void {
    const now = Date.now(); let rate = rates.get(key);
    if (!rate || now-rate.at >= window) { rate = { at: now, count: 0 }; rates.set(key, rate); }
    if (++rate.count > maximum) throw new HttpError(429, 'Muitos pedidos. Tente novamente em instantes.');
  }
  function disconnect(member: OnlineMember, res: ServerResponse): void {
    if (streams.get(member) !== res) return;
    streams.delete(member); member.connected = false; member.seenAt = Date.now(); member.input = idleInput(); member.sim.clearInput();
  }
  const server = createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD' || !options.staticDir) throw new HttpError(404, 'Não encontrado.');
        const root = resolve(options.staticDir), path = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/online.html' : url.pathname));
        if (!path.startsWith(root+sep)) throw new HttpError(403, 'Não permitido.');
        const types: Record<string, string> = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.ttf':'font/ttf', '.mp3':'audio/mpeg', '.json':'application/json' };
        res.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
        const file = createReadStream(path);
        file.on('error', () => { if (!res.headersSent) json(res,404,{ message:'Não encontrado.' }); else res.destroy(); });
        if (req.method === 'HEAD') { file.destroy(); res.end(); } else file.pipe(res);
        return;
      }
      const origin = req.headers.origin;
      if (origin && origin !== options.origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`)
        throw new HttpError(403, 'Origem não permitida.');
      const address = req.socket.remoteAddress ?? 'local';
      limit('ip:'+address, 300, 1000);
      if (req.method === 'GET' && url.pathname === '/api/health') { json(res,saveError?503:200,{ ok: !saveError, version: ONLINE_VERSION }); return; }
      if (req.method === 'POST' && url.pathname === '/api/rooms') {
        limit('create:'+address, 6, 60_000);
        if (rooms.size >= ONLINE_LIMITS.rooms) throw new HttpError(503, 'O servidor está cheio.');
        const v = await body(req);
        if (v.version !== ONLINE_VERSION || typeof v.name !== 'string' || typeof v.loadout !== 'string' || !isWorldSeed(Number(v.seed)))
          throw new HttpError(400, 'Versão, nome, equipamento ou semente inválidos.');
        const room = new OnlineRoom(Number(v.seed));
        try { const ticket = room.join(v.name,v.loadout); rooms.set(room.id,room); json(res,201,ticket); }
        catch (error) { room.dispose(); throw new HttpError(400,(error as Error).message); }
        return;
      }
      const match = /^\/api\/rooms\/([\w-]{6,32})\/(join|events|input|command|leave)$/.exec(url.pathname);
      if (!match) throw new HttpError(404, 'Não encontrado.');
      const room = rooms.get(match[1]); if (!room) throw new HttpError(404, 'Sala não encontrada.');
      const action = match[2];
      if (action === 'join' && req.method === 'POST') {
        limit('join:'+address, 20, 60_000);
        const v = await body(req);
        if (v.version !== ONLINE_VERSION || !equalSecret(room.invite, v.invite)) throw new HttpError(403, 'Convite inválido.');
        if (typeof v.name !== 'string' || typeof v.loadout !== 'string') throw new HttpError(400, 'Nome ou equipamento inválido.');
        try { json(res,201,room.join(v.name,v.loadout)); } catch (error) { throw new HttpError(400,(error as Error).message); }
        return;
      }
      const member = room.authenticate(req.headers.authorization?.replace(/^Bearer /,''));
      if (!member) throw new HttpError(401, 'Sessão expirada. Entre novamente pelo convite.');
      limit('member:'+member.id, 60, 1000);
      if (action === 'events' && req.method === 'GET') {
        const old = streams.get(member);
        streams.set(member,res); old?.end('event: replaced\ndata: {}\n\n'); member.connected = true; member.seenAt = Date.now(); member.inputAt = 0; member.input = idleInput();
        res.writeHead(200, { 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache, no-transform', Connection:'keep-alive', 'X-Accel-Buffering':'no' });
        res.write(': connected\n\n');
        res.on('close', () => disconnect(member,res));
        return;
      }
      if (action === 'input' && req.method === 'POST') {
        const v = await body(req), input = validInput(v.input);
        if (!input || !Number.isSafeInteger(v.sequence)) throw new HttpError(400, 'Comandos inválidos.');
        const accepted=room.input(member,input,Number(v.sequence));
        if(accepted)room.camera(member,v.viewport,v.exclusion);
        json(res,200,{ ok: accepted, sequence: member.sequence }); return;
      }
      if (action === 'command' && req.method === 'POST') {
        const result = room.command(member,await body(req)); json(res,result.ok?200:400,result); return;
      }
      if (action === 'leave' && req.method === 'POST') {
        streams.get(member)?.end(); streams.delete(member); room.members.delete(member.id); json(res,200,{ ok:true }); return;
      }
      throw new HttpError(405, 'Método não permitido.');
    })().catch(error => {
      if (!res.headersSent && !res.destroyed) json(res,error instanceof HttpError ? error.status : 500,
        { message: error instanceof HttpError ? error.message : 'Não foi possível concluir o pedido.' });
      else res.destroy();
      if (!(error instanceof HttpError)) console.error('Online request failed:', (error as Error).message);
    });
  });
  server.requestTimeout = 15_000; server.headersTimeout = 10_000;
  let previous = performance.now(), accumulator = 0, frameAt = 0;
  const timer = setInterval(() => {
    const stamp = performance.now(), now = Date.now();
    accumulator += Math.min(.25,(stamp-previous)/1000); previous = stamp;
    while (accumulator >= FIXED_STEP) { for (const room of rooms.values()) room.advance(now); accumulator -= FIXED_STEP; }
    if (stamp-frameAt < 1000/15) return;
    frameAt = stamp;
    for (const room of rooms.values()) {
      if (![...room.members.values()].some(member => member.connected)) continue;
      const frame = room.frame();
      for (const member of room.members.values()) {
        const stream = streams.get(member);
        if (!stream) continue;
        if (stream.writableLength > 1_000_000 || now-member.inputAt > 30_000 && member.inputAt !== 0) { stream.end(); continue; }
        if (stream.writableLength > 64_000) continue;
        stream.write('data: '+encodeOnline({ ...frame,self:member.id })+'\n\n');
      }
    }
  }, 8);
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key,rate] of rates) if (now-rate.at > 60_000) rates.delete(key);
    for (const [id,room] of rooms) {
      const playing = [...room.members.values()].some(member=>member.connected);
      for (const [key,member] of room.members) if (playing && !member.connected && now-member.seenAt > ONLINE_LIMITS.reconnect) room.members.delete(key);
      if (!room.members.size && now-room.lastActive > ONLINE_LIMITS.reconnect) { room.dispose(); rooms.delete(id); }
      else if (!playing && now-room.lastActive > 7*24*60*60*1000) { room.dispose(); rooms.delete(id); }
    }
  },10_000);
  function persist(): Promise<void> {
    if (!options.dataDir) return Promise.resolve();
    const data = JSON.stringify([...rooms.values()].map(room => room.save()));
    saving = saving.then(async () => {
      const destination = resolve(options.dataDir!,'rooms.json'), temp = destination+'.tmp';
      try { await writeFile(temp,data,{mode:0o600}); await rename(temp,destination); saveError = ''; }
      catch (error) { saveError = (error as Error).message; console.error('Online save failed:',saveError); }
    });
    return saving;
  }
  const saves = setInterval(() => { void persist(); },10_000);
  async function close(): Promise<void> {
    clearInterval(timer); clearInterval(cleanup); clearInterval(saves);
    for (const stream of streams.values()) stream.end();
    await persist();
    if (server.listening) await new Promise<void>((done,reject) => server.close(error => error ? reject(error) : done()));
    for (const room of rooms.values()) room.dispose();
  }
  return { server,rooms,persist,close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const service = await createOnlineServer({ dataDir: process.env.ONLINE_DATA_DIR ?? resolve('online-data'),
    staticDir: resolve(import.meta.dirname,'../dist'), origin: process.env.PUBLIC_ORIGIN });
  service.server.listen(Number(process.env.PORT ?? 3001),process.env.HOST ?? '127.0.0.1',() => console.log('Evergrow Online listening on port',process.env.PORT ?? 3001));
  let closing = false;
  const shutdown = () => { if (closing) return; closing = true; void service.close().then(() => { process.exitCode=0; },error => { console.error(error); process.exitCode=1; }); };
  process.on('SIGTERM',shutdown); process.on('SIGINT',shutdown);
}
