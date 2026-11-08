import './ui-kit.css';
import './style.css';
import './typography.css';
import './online.css';
import { loadGameFont, text } from './font.ts';
import { installUITheme } from './ui-theme.ts';
import { STARTER_LOADOUTS } from './items.ts';
import { escapeUI } from './ui-components.ts';
import { OnlineClient } from './online-client.ts';
import { idleInput, ONLINE_VERSION, type OnlineSnapshot, type RoomTicket } from './online-protocol.ts';
import { Simulation } from './simulation.ts';
import { World } from './world.ts';
import { Renderer, type RenderSettings } from './renderer.ts';
import { PostFX } from './postfx.ts';
import { GameInput } from './game-input.ts';
import { GameAudio } from './audio.ts';
import { controls } from './control-preferences.ts';
import { InventoryPanel } from './inventory-panel.ts';
import { SkillTreePanel } from './skill-tree-panel.ts';
import type { CharacterCommand } from './character-commands.ts';
import type { Player, CombatEvent } from './model.ts';
import { hoveredGroundLoot } from './ground-loot-hover.ts';
import { ServicePanel } from './service-panel.ts';
import { buildingNPC, focusNPC } from './npcs.ts';
import { refreshCharacter } from './character.ts';
import type { CharacterSheet } from './character-types.ts';

installUITheme();
const app=document.querySelector<HTMLElement>('#app')!;
const SESSION_KEY='evergrow-online-session-v1';
const personalEvents=new Set<CombatEvent['type']>(['hurt','potion','gold','experience','level','loot','insufficient-mana','notice','pickup','journey']);
let game: OnlineGame | undefined;

function savedTicket(): RoomTicket | null {
  try {
    const v=JSON.parse(sessionStorage.getItem(SESSION_KEY)??'null') as RoomTicket|null;
    return v&&v.version===ONLINE_VERSION&&typeof v.token==='string'&&typeof v.room==='string'&&typeof v.player==='string' ? v:null;
  }catch{return null;}
}
function saveTicket(ticket:RoomTicket|null):void {
  try{if(ticket)sessionStorage.setItem(SESSION_KEY,JSON.stringify(ticket));else sessionStorage.removeItem(SESSION_KEY);}catch{/* Play remains available with browser storage disabled. */}
}
function inviteFromHash():{room:string;invite:string}|null {
  const hash=new URLSearchParams(location.hash.slice(1)),room=hash.get('room'),invite=hash.get('invite');
  return room&&invite?{room,invite}:null;
}
function showLobby(message=''):void {
  game?.dispose();game=undefined;
  const invitation=inviteFromHash(),saved=savedTicket();
  app.innerHTML=`<section class="online-lobby"><div class="online-card">
    <p class="online-eyebrow">COOPERATIVO · ATÉ 4 JOGADORES</p><h1>Evergrow<span>Online</span></h1>
    <p class="online-intro">A floresta é a mesma.<br>Agora, vocês a atravessam juntos.</p>
    <form id="online-form"><label>Seu nome<input name="name" autocomplete="nickname" maxlength="24" required placeholder="Nome do viajante" /></label>
    <label>Equipamento inicial<select name="loadout">${STARTER_LOADOUTS.map(loadout=>`<option value="${loadout.id}">${escapeUI(loadout.label)}</option>`).join('')}</select></label>
    <label${invitation?' hidden':''}>Semente do mundo<input name="seed" inputmode="numeric" type="number" min="0" max="4294967295" step="1" value="7319" required /></label>
    <button class="online-primary" type="submit">${invitation?'Entrar com o convite':'Criar sala privada'}</button></form>
    ${saved?'<button id="online-resume" type="button" class="online-secondary">Retomar minha partida</button>':''}
    <p id="online-message" class="online-message" role="status">${escapeUI(message|| (invitation?'Você recebeu um convite para uma sala privada.':'Crie a sala e envie o convite aos seus amigos.'))}</p>
    <details class="online-help"><summary>Como jogar</summary><p>WASD para mover, mouse para mirar, clique esquerdo para atacar. Espaço esquiva, Q usa poção. I abre o inventário, T abre as habilidades. Clique no nome de um item no chão para pegá-lo.</p><p>Os menus não pausam a sala. Seus personagens ficam no servidor. O convite dá acesso à sala; guarde-o para seu grupo.</p></details>
    <a class="online-offline" href="/index.html">Jogar solo</a>
    </div><footer>Derivado de Evergrow, por Dimillian · <a href="https://github.com/romulomazzocco/Evergrow-Online">Código-fonte</a> · <a href="https://github.com/Dimillian/Evergrow">Original</a> · AGPL-3.0</footer></section>`;
  app.querySelector('#online-resume')?.addEventListener('click',()=>{if(saved)void startGame(saved);});
  const form=app.querySelector<HTMLFormElement>('#online-form')!,status=app.querySelector<HTMLElement>('#online-message')!;
  form.addEventListener('submit',event=>{
    event.preventDefault();const data=new FormData(form),button=form.querySelector<HTMLButtonElement>('button')!;
    button.disabled=true;status.textContent='Preparando a sala…';
    void(async()=>{
      const res=await fetch(invitation?`/api/rooms/${encodeURIComponent(invitation.room)}/join`:'/api/rooms',{
        method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(10_000),
        body:JSON.stringify({version:ONLINE_VERSION,name:data.get('name'),loadout:data.get('loadout'),seed:Number(data.get('seed')),invite:invitation?.invite})});
      const result=await res.json().catch(()=>({message:'O servidor de salas está indisponível.'})) as RoomTicket&{message?:string};
      if(!res.ok)throw new Error(result.message??'Não foi possível entrar na sala.');
      await startGame(result);
    })().catch(error=>{status.textContent=error instanceof Error?error.message:'Servidor indisponível.';button.disabled=false;});
  });
}
async function startGame(ticket:RoomTicket):Promise<void> {
  await loadGameFont();saveTicket(ticket);
  game?.dispose();game=new OnlineGame(ticket);
}

class OnlineGame {
  private world:World;
  private sim:Simulation;
  private renderer=new Renderer(true);
  private input=new GameInput(controls);
  private client:OnlineClient;
  private audio=new GameAudio();
  private canvas:HTMLCanvasElement;
  private ui:HTMLCanvasElement;
  private ctx:CanvasRenderingContext2D;
  private fx:PostFX;
  private abort=new AbortController();
  private frame=0;
  private inputTimer:ReturnType<typeof setInterval>;
  private previous=performance.now();
  private receivedAt=0;
  private lastSnapshot:OnlineSnapshot|null=null;
  private connected=false;
  private sending=false;
  private sequence=Date.now();
  private panel:'inventory'|'skills'|'service'|null=null;
  private inventory:InventoryPanel;
  private skills:SkillTreePanel;
  private service:ServicePanel;
  private companions:Player[]=[];
  private lastParty='';
  private reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(ticket:RoomTicket){
    this.world=new World(ticket.seed);this.sim=new Simulation(this.world,{seed:ticket.seed,spawn:false});
    app.innerHTML=`<div class="online-game"><canvas id="online-world" tabindex="0" aria-label="Evergrow Online"></canvas><canvas id="online-ui" aria-hidden="true"></canvas>
      <nav class="online-bar" aria-label="Sala"><span id="online-connection" role="status">Conectando…</span><button id="online-copy">Copiar convite</button><button id="online-inventory">Inventário</button><button id="online-skills">Habilidades</button><button id="online-leave">Sair</button></nav>
      <ul id="online-party" class="online-party" aria-label="Jogadores na sala"></ul>
      <p id="online-toast" class="online-toast" role="status" hidden></p>
      <section id="online-death" class="online-death" hidden><h2>Você caiu</h2><p>Seus companheiros continuam na floresta.</p><button id="online-revive" class="online-primary">Voltar ao acampamento</button></section>
      <div id="online-panels"></div></div>`;
    this.canvas=app.querySelector<HTMLCanvasElement>('#online-world')!;this.ui=app.querySelector<HTMLCanvasElement>('#online-ui')!;
    this.ctx=this.ui.getContext('2d')!;this.fx=new PostFX(this.canvas);
    const mount=app.querySelector<HTMLElement>('#online-panels')!,signal=this.abort.signal;
    const command=(value:CharacterCommand)=>this.command(value);
    this.inventory=new InventoryPanel(mount,{
      close:()=>this.closePanel(),equip:(index,slot)=>command({type:'equip',index,slot}),unequip:(slot,index)=>command({type:'unequip',slot,index}),
      move:(from,to)=>command({type:'moveItem',from,to}),allocate:attribute=>command({type:'allocateAttribute',attribute}),
      sort:mode=>command({type:'sortInventory',mode}),equipBest:choice=>command({type:'equipBest',choice}),
      lock:(id,locked)=>command({type:'lockItem',id,locked}),assignSkill:(slot,skill)=>command({type:'assignSkill',slot,skill}),openSkills:()=>this.openPanel('skills'),
      drop:source=>this.command({type:'drop',source}),
    });
    this.skills=new SkillTreePanel(mount,{close:()=>this.closePanel(),develop:command,allocate:id=>command({type:'allocateNode',id}),assign:(slot,skill)=>command({type:'assignSkill',slot,skill})},{autoTour:false});
    this.service=new ServicePanel(mount,{close:()=>this.closePanel(),sort:(target,tab)=>command(target==='storage'?{type:'sortStorage',tab}:{type:'sortInventory',mode:'compact'}),
      trade:async quote=>{
        try{
          const result=await this.client.post('command',{type:'service',quote});
          if(result.character){this.sim.player.character=result.character as CharacterSheet;refreshCharacter(this.sim.player);}
          return {ok:result.ok===true,message:String(result.message??'')};
        }catch(error){return {ok:false,message:(error as Error).message};}
      }});
    this.client=new OnlineClient(ticket,snapshot=>this.snapshot(snapshot),(status,connected)=>{
      this.connected=connected;const label=app.querySelector<HTMLElement>('#online-connection');if(label){label.textContent=status;label.dataset.connected=String(connected);}
      if(!connected)this.input.clear();
    });
    app.querySelector('#online-copy')!.addEventListener('click',()=>{
      const url=new URL('/online.html',location.origin);url.hash=new URLSearchParams({room:ticket.room,invite:ticket.invite}).toString();
      const copy=navigator.clipboard?.writeText(url.href)??Promise.reject(new Error('Clipboard unavailable'));
      void copy.then(()=>this.toast('Convite copiado.'),()=>{
        this.toast('Copie o convite abaixo.');const field=document.createElement('input');field.className='online-invite-field';field.value=url.href;field.readOnly=true;
        app.querySelector('.online-invite-field')?.remove();
        app.querySelector('.online-bar')!.append(field);field.focus();field.select();
      });
    },{signal});
    app.querySelector('#online-leave')!.addEventListener('click',()=>{
      void this.client.post('leave',{}).then(()=>{saveTicket(null);history.replaceState(null,'',location.pathname);showLobby();},()=>showLobby('A sala está sem conexão. Use Retomar minha partida para tentar novamente.'));
    },{signal});
    app.querySelector('#online-inventory')!.addEventListener('click',()=>this.openPanel('inventory'),{signal});
    app.querySelector('#online-skills')!.addEventListener('click',()=>this.openPanel('skills'),{signal});
    app.querySelector('#online-revive')!.addEventListener('click',()=>this.command({type:'revive'}),{signal});
    this.canvas.addEventListener('contextmenu',event=>event.preventDefault(),{signal});
    this.canvas.addEventListener('pointermove',event=>this.input.movePointer(event.clientX,event.clientY,this.canvas.getBoundingClientRect(),this.renderer.width,this.renderer.height),{signal});
    this.canvas.addEventListener('pointerdown',event=>{
      this.canvas.focus();void this.audio.unlock();
      this.input.movePointer(event.clientX,event.clientY,this.canvas.getBoundingClientRect(),this.renderer.width,this.renderer.height);
      const loot=hoveredGroundLoot(this.renderer.groundLootLabels,this.input.pointer.x,this.input.pointer.y);
      if(event.button===0&&loot){this.command({type:'pickup',id:loot.id});return;}
      if(event.button===0&&this.openService(this.renderer.screenToWorld(this.input.pointer.x,this.input.pointer.y)))return;
      this.input.pointerDown(event.button);
    },{signal});
    window.addEventListener('pointerup',event=>this.input.pointerUp(event.button),{signal});
    window.addEventListener('keydown',event=>{
      if((event.target as HTMLElement)?.closest('input,textarea,select'))return;
      if(event.code==='Escape'){this.closePanel();return;}
      if(event.code==='KeyI'||event.code==='KeyC'){event.preventDefault();if(!event.repeat)this.openPanel('inventory');return;}
      if(event.code==='KeyT'){event.preventDefault();if(!event.repeat)this.openPanel('skills');return;}
      if(this.panel)return;
      if(controls.action(event.code)==='interact'){event.preventDefault();if(!event.repeat)this.openService();return;}
      if(controls.action(event.code)){event.preventDefault();this.input.keyDown(event.code);}
    },{signal});
    window.addEventListener('keyup',event=>this.input.keyUp(event.code),{signal});
    window.addEventListener('blur',()=>this.input.clear(),{signal});
    document.addEventListener('visibilitychange',()=>this.input.clear(),{signal});
    this.canvas.addEventListener('wheel',event=>{event.preventDefault();this.renderer.zoomByWheel(event.deltaY,event.deltaMode,innerHeight);},{signal,passive:false});
    window.addEventListener('resize',()=>this.resize(),{signal});
    this.resize();this.canvas.focus();this.client.connect();
    this.inputTimer=setInterval(()=>this.sendInput(),1000/30);
    this.frame=requestAnimationFrame(now=>this.render(now));
  }
  private toast(message:string):void {
    const toast=app.querySelector<HTMLElement>('#online-toast');if(toast){toast.textContent=message;toast.hidden=false;}
  }
  private command(value:unknown):void {
    if(!this.connected){this.toast('Aguarde a conexão com a sala.');return;}
    void this.client.post('command',value).catch(error=>this.toast((error as Error).message));
  }
  private closePanel():void {this.inventory.close();this.skills.close();this.service.close();this.panel=null;this.input.clear();this.canvas.focus();}
  private openService(pointer?:{x:number;y:number}):boolean {
    const p=this.sim.player,npc=focusNPC(this.world.getBuildings(p.x-200,p.y-200,400,400).flatMap(building=>{
      const npc=buildingNPC(building);return npc?[npc]:[];
    }),p,this.world,pointer);
    if(!npc)return false;
    this.closePanel();this.panel='service';this.service.open(p,npc);return true;
  }
  private openPanel(panel:'inventory'|'skills'):void {
    if(!this.lastSnapshot||this.sim.player.dead)return;
    const previous=this.panel;this.closePanel();if(previous===panel)return;
    this.panel=panel;if(panel==='inventory')this.inventory.open(this.sim.player);else this.skills.open(this.sim.player);
  }
  private sendInput():void {
    if(!this.connected||this.sending)return;
    const aim=this.renderer.screenToWorld(this.input.pointer.x,this.input.pointer.y);
    const input=this.panel||document.hidden||!document.hasFocus()?idleInput():this.input.consume(aim,false);
    this.sending=true;this.sequence=Math.max(Date.now(),this.sequence+1);
    void this.client.post('input',{sequence:this.sequence,input,viewport:this.renderer.combatViewport,exclusion:this.renderer.spawnExclusionBounds(this.sim.player)})
      .catch(()=>{}).finally(()=>{this.sending=false;});
  }
  private snapshot(snapshot:OnlineSnapshot):void {
    if(snapshot.version!==ONLINE_VERSION){this.toast('Atualize a página para usar a versão atual.');this.client.dispose();return;}
    if(this.lastSnapshot&&snapshot.tick<=this.lastSnapshot.tick)return;
    const own=snapshot.players.find(member=>member.id===snapshot.self);if(!own)return;
    const old=this.lastSnapshot;
    // Retain the previous delivered positions, rather than a 120 Hz position that
    // is only a fraction of a network frame away from the current position.
    const position=(next:{x:number;y:number;prevX:number;prevY:number},before?:{x:number;y:number})=>{
      const smooth=before&&Math.hypot(next.x-before.x,next.y-before.y)<400;
      next.prevX=smooth?before.x:next.x;next.prevY=smooth?before.y:next.y;
    };
    for(const member of snapshot.players)position(member.player,old?.players.find(p=>p.id===member.id)?.player);
    for(const enemy of snapshot.enemies)position(enemy,old?.enemies.find(e=>e.id===enemy.id));
    for(const shot of snapshot.projectiles)position(shot,old?.projectiles.find(p=>p.id===shot.id));
    Object.assign(this.sim.player,own.player);this.sim.time=snapshot.time;this.sim.enemies=snapshot.enemies;this.sim.projectiles=snapshot.projectiles;
    this.sim.groundEffects=snapshot.groundEffects;this.sim.chains=snapshot.chains;this.sim.pickups=snapshot.pickups;
    this.sim.groundItems=snapshot.groundItems;this.sim.groundGold=snapshot.groundGold;
    this.sim.brokenContainers.clear();for(const id of snapshot.brokenContainers)this.sim.brokenContainers.add(id);
    this.world.setBrokenContainers(this.sim.brokenContainers);
    this.companions=snapshot.players.filter(member=>member.id!==snapshot.self&&member.connected).map(member=>member.player);
    if(!old)this.renderer.snapTo(this.sim.player);
    const events=snapshot.events.filter(({player,event})=>!personalEvents.has(event.type)||player===snapshot.self).map(record=>record.event);
    this.renderer.handleEvents(events,this.reducedMotion);for(const event of events)this.audio.play(event);
    for(const event of events)if(event.type==='notice')this.toast(event.message);
    const party=JSON.stringify(snapshot.players.map(member=>[member.id,member.connected,member.player.level,member.player.dead]));
    if(party!==this.lastParty){
      this.lastParty=party;
      app.querySelector('#online-party')!.innerHTML=snapshot.players.map(member=>`<li class="${member.id===snapshot.self?'self':''}"><span>${escapeUI(member.player.name??'Viajante')}</span><small>Nv. ${member.player.level} · ${member.player.dead?'Caído':member.connected?'Na sala':'Reconectando'}</small></li>`).join('');
    }
    app.querySelector<HTMLElement>('#online-death')!.hidden=!this.sim.player.dead;
    if(this.sim.player.dead&&this.panel)this.closePanel();
    if(this.panel==='inventory')this.inventory.refresh(this.sim.player);if(this.panel==='skills')this.skills.refresh(this.sim.player);
    this.receivedAt=performance.now();this.lastSnapshot=snapshot;
  }
  private resize():void {
    const density=Math.min(1.5,devicePixelRatio||1),width=Math.max(1,Math.round(innerWidth*density)),height=Math.max(1,Math.round(innerHeight*density));
    this.canvas.width=this.ui.width=width;this.canvas.height=this.ui.height=height;this.renderer.resize(width,height);
    this.renderer.cursorPixelScale={x:density,y:density};
  }
  private render(now:number):void {
    const dt=Math.min(.1,(now-this.previous)/1000);this.previous=now;
    if(this.lastSnapshot){
      const alpha=Math.min(1,(now-this.receivedAt)/(1000/15));
      const settings:RenderSettings={phase:'playing',reducedMotion:this.reducedMotion,companions:this.companions,interpolationAlpha:alpha,showGroundLootNames:true};
      this.renderer.pointerX=this.input.pointer.x;this.renderer.pointerY=this.input.pointer.y;this.renderer.pointerActive=this.input.pointer.present&&!this.panel;
      this.renderer.render(this.sim,this.world,dt,settings);this.fx.render(this.renderer.canvas,this.renderer.hurt,this.renderer.emission);
      this.ctx.clearRect(0,0,this.ui.width,this.ui.height);this.renderer.renderUI(this.ctx,this.sim,this.world,settings);
      for(const companion of this.companions){
        const x=companion.prevX+(companion.x-companion.prevX)*alpha,y=companion.prevY+(companion.y-companion.prevY)*alpha;
        const point=this.renderer.worldToScreen(x,y-70);text(this.ctx,companion.name??'Viajante',point.x,point.y,.8,'#b9dfcc','center');
      }
    }
    this.frame=requestAnimationFrame(stamp=>this.render(stamp));
  }
  dispose():void {
    this.abort.abort();this.client.dispose();clearInterval(this.inputTimer);cancelAnimationFrame(this.frame);
    this.inventory.dispose();this.skills.dispose();this.service.dispose();this.renderer.reset();this.fx.dispose();this.audio.dispose();this.world.dispose();
  }
}

showLobby();
if(import.meta.hot)import.meta.hot.dispose(()=>{game?.dispose();game=undefined;});
