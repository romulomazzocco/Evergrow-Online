import { decodeOnline, ONLINE_LIMITS, type OnlineSnapshot, type RoomTicket } from './online-protocol.ts';

/** HTTP streaming works through the same HTTPS origin as the game. No account,
 * WebRTC permissions or extra public ports are needed by the browser. */
export class OnlineClient {
  readonly ticket: RoomTicket;
  private abort = new AbortController();
  private streaming?: AbortController;
  private disposed = false;
  private retry?: ReturnType<typeof setTimeout>;
  private watchdog?: ReturnType<typeof setInterval>;
  private lastFrame = 0;
  private failures = 0;
  onSnapshot: (snapshot: OnlineSnapshot) => void;
  onStatus: (status: string, connected: boolean) => void;

  constructor(ticket: RoomTicket, snapshot: OnlineClient['onSnapshot'], status: OnlineClient['onStatus']) {
    this.ticket=ticket; this.onSnapshot=snapshot; this.onStatus=status;
  }
  private path(action: string): string { return `/api/rooms/${encodeURIComponent(this.ticket.room)}/${action}`; }
  async post(action: string, value: unknown): Promise<Record<string, unknown>> {
    const res = await fetch(this.path(action),{ method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${this.ticket.token}` },
      body:JSON.stringify(value), signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(8000)]) });
    const result = await res.json() as Record<string,unknown>;
    if (!res.ok) throw new Error(String(result.message ?? 'O servidor recusou o pedido.'));
    return result;
  }
  connect(): void {
    if (this.disposed) return;
    this.streaming?.abort(); this.streaming=new AbortController();
    const signal=AbortSignal.any([this.abort.signal,this.streaming.signal]);
    this.onStatus(this.failures?'Reconectando…':'Conectando…',false);
    this.lastFrame=performance.now();
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog=setInterval(()=>{ if(performance.now()-this.lastFrame>10_000)this.streaming?.abort(); },2000);
    void (async()=>{
      const res=await fetch(this.path('events'),{ headers:{ Authorization:`Bearer ${this.ticket.token}` },signal });
      if(!res.ok){
        const error=await res.json() as {message?:string};
        if(res.status===401||res.status===404){this.onStatus(error.message??'Sessão encerrada.',false);this.dispose();return;}
        throw new Error(error.message??'Conexão indisponível.');
      }
      const reader=res.body!.getReader(),decoder=new TextDecoder();let buffer='';
      try{
        while(!signal.aborted){
          const {value,done}=await reader.read();if(done)break;
          buffer+=decoder.decode(value,{stream:true});
          if(buffer.length>ONLINE_LIMITS.snapshot)throw new Error('Resposta do servidor muito grande.');
          let end:number;
          while((end=buffer.indexOf('\n\n'))>=0){
            const message=buffer.slice(0,end);buffer=buffer.slice(end+2);
            if(message.startsWith('event: replaced')){this.onStatus('Personagem aberto em outra aba.',false);this.dispose();return;}
            const data=message.split('\n').find(line=>line.startsWith('data: '));if(!data)continue;
            const snapshot=decodeOnline<OnlineSnapshot>(data.slice(6));
            this.lastFrame=performance.now();this.failures=0;this.onSnapshot(snapshot);this.onStatus('Conectado',true);
          }
        }
      }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
      if(!this.disposed)throw new Error('Conexão interrompida.');
    })().catch(()=>{
      if(this.disposed)return;
      this.failures++;this.onStatus('Reconectando…',false);
      this.retry=setTimeout(()=>this.connect(),Math.min(8000,500*2**Math.min(4,this.failures)));
    });
  }
  dispose(): void {
    this.disposed=true;this.abort.abort();this.streaming?.abort();
    clearTimeout(this.retry);clearInterval(this.watchdog);
  }
}
