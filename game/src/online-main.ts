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
import type { Player, CombatEvent, Input } from './model.ts';
import { hoveredGroundLoot } from './ground-loot-hover.ts';
import { ServicePanel } from './service-panel.ts';
import { buildingNPC, focusNPC } from './npcs.ts';
import { refreshCharacter } from './character.ts';
import type { CharacterSheet } from './character-types.ts';
import { EventPanel } from './poi-panel.ts';
import { eventInteractionSites, focusEvent } from './poi-content.ts';
import { generateDungeon } from './dungeon.ts';
import { currentDungeon } from './dungeon-state.ts';
import { DungeonWorld } from './dungeon-world.ts';
import { RiftWorld } from './rift-world.ts';
import { dungeonRunExit } from './dungeon-locations.ts';
import { RiftPanel } from './rift-panel.ts';
import { ExpeditionPanel } from './expedition-panel.ts';
import { drawRiftHUD } from './rift-hud.ts';
import { Exploration } from './exploration.ts';
import { WorldMap } from './world-map.ts';
import { DungeonMap, drawCryptMinimap } from './dungeon-map.ts';
import { mapTravelProblem } from './travel-command.ts';
import { activityStatus } from './activity-status.ts';
import { getMinimapRect, getMinimapChartRect, projectMapPoint } from './map-view.ts';
import { portalMapMarkers, townPortalAnchor, withinPortalReach } from './travel.ts';
import './world-map.css';
import './dungeon.css';
import { JourneyPanel } from './journey-panel.ts';
import { onlineJourneyFacts } from './online-journeys.ts';
import { pinnedJourney } from './journey-state.ts';
import { publicJourneyMarker } from './journey-marker.ts';
import { dungeonJourney } from './dungeon-journey.ts';
import { GamepadInput, PAD } from './gamepad-input.ts';
import { GamepadMenu } from './gamepad-menu.ts';
import { OnlineInputBuffer } from './online-input.ts';
import { TouchHUD } from './touch-hud.ts';
import { bindTouchCanvas } from './touch-canvas.ts';
import { basicAttackWeapon, deriveAttackStats } from './equipment.ts';
import { skillWeapon } from './skill-content.ts';
import { resolveSkill } from './skill-progression.ts';
import { directionalAimProfile } from './ranged-aim.ts';
import { skillTargetPoint } from './skill-target-point.ts';
import { portalActionMode, portalDestinations } from './portal-destination.ts';
import { presentationProfile, presentationViewport } from './presentation-viewport.ts';
import { getHUDLayout, isHUDPoint } from './hud-layout.ts';

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
  private surface:World;
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
  private panel:'inventory'|'skills'|'service'|'event'|'rift'|'expedition'|'map'|'journeys'|'menu'|null=null;
  private inventory:InventoryPanel;
  private skills:SkillTreePanel;
  private service:ServicePanel;
  private events:EventPanel;
  private rifts:RiftPanel;
  private expeditions:ExpeditionPanel;
  private exploration:Exploration;
  private worldMap:WorldMap;
  private dungeonMap:DungeonMap;
  private journeys:JourneyPanel;
  private touch:TouchHUD;
  private gamepad=new GamepadInput();
  private gamepadMenu=new GamepadMenu();
  private padInput=new OnlineInputBuffer();
  private usingGamepad=false;
  private padAngle:number|null=null;
  private padDistance=180;
  private touchPreview=false;
  private presentation=presentationProfile({android:false,coarsePointer:matchMedia('(pointer: coarse)').matches});
  private companions:Player[]=[];
  private lastParty='';
  private toastTimer?:ReturnType<typeof setTimeout>;
  private reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(ticket:RoomTicket){
    this.surface=new World(ticket.seed);this.world=this.surface;this.sim=new Simulation(this.world,{seed:ticket.seed,spawn:false});
    this.exploration=new Exploration(this.surface);
    app.innerHTML=`<div class="online-game"><canvas id="online-world" tabindex="0" aria-label="Evergrow Online"></canvas><canvas id="online-ui" aria-hidden="true"></canvas>
      <nav class="online-bar" aria-label="Sala"><span id="online-connection" role="status">Conectando…</span><button id="online-open-menu">Sala</button></nav>
      <ul id="online-party" class="online-party" aria-label="Jogadores na sala" hidden></ul>
      <p id="online-toast" class="online-toast" role="status" hidden></p>
      <section id="online-death" class="online-death" hidden><h2>Você caiu</h2><p>Seus companheiros continuam na floresta.</p><button id="online-revive" class="online-primary">Voltar ao acampamento</button></section>
      <div id="online-panels"><section id="online-menu" class="online-menu" hidden aria-label="Menu da sala"><h2>Sala cooperativa</h2><p>O mundo continua enquanto você abre os menus.</p><button id="online-resume-game">Continuar</button><button id="online-copy">Copiar convite</button><button id="online-players" aria-expanded="false" aria-controls="online-party">Jogadores</button><button id="online-inventory">Inventário</button><button id="online-skills">Habilidades</button><button id="online-journeys">Atividades</button><button id="online-map">Mapa</button><button id="online-home">Portal</button><button id="online-exit" hidden>Sair da masmorra</button><button id="online-sound">Som ligado</button><button id="online-fullscreen">Tela cheia</button><button id="online-leave">Sair da sala</button></section></div></div>`;
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
    this.events=new EventPanel(mount,{close:()=>this.closePanel(),choose:(site,choice)=>{this.closePanel();this.command({type:'event',id:site.id,choice});},
      enter:entrance=>{this.closePanel();this.command({type:'dungeon',kind:'enter',id:entrance.id});}});
    const travel=async(action:import('./dungeon-command.ts').DungeonAction)=>{
      try{await this.client.post('command',{type:'dungeon',...action});this.closePanel();return true;}
      catch(error){this.toast((error as Error).message);return false;}
    };
    this.rifts=new RiftPanel(mount,{close:()=>this.closePanel(),enter:travel});
    this.expeditions=new ExpeditionPanel(mount,{close:()=>this.closePanel(),enter:travel});
    this.worldMap=new WorldMap(this.surface,this.exploration,mount,()=>this.closePanel());
    this.worldMap.setPortalMarkers(()=>portalMapMarkers(this.sim.travel,band=>this.surface.getPortalAnchor(band)));
    this.worldMap.setActivityStateReader(poi=>activityStatus(poi,{events:this.sim.eventState,expeditions:this.sim.expeditions,campCleared:id=>this.sim.getCampState(id)==='cleared'}));
    this.worldMap.setTravel({problem:id=>mapTravelProblem(this.sim,this.exploration,id),travel:async id=>{
      try{const result=await this.client.post('command',{type:'mapTravel',id});this.closePanel();return {ok:true,message:String(result.message??'')};}
      catch(error){return {ok:false,message:(error as Error).message};}
    }});
    this.dungeonMap=new DungeonMap(mount,()=>this.closePanel(),()=>{
      this.dungeonMap.close();this.worldMap.open({x:this.sim.expeditions.surfaceX,y:this.sim.expeditions.surfaceY,angle:0});
    });
    this.journeys=new JourneyPanel(mount,app.querySelector<HTMLElement>('.online-game')!,{
      close:()=>this.closePanel(),open:id=>this.openJourneys(id),command:async command=>{
        try{await this.client.post('command',{type:'journey',command});return true;}catch(error){this.toast((error as Error).message);return false;}
      },map:id=>{
        const goal=[this.sim.journeys.nearestTown,this.sim.journeys.townPin,...this.sim.journeys.accepted,...this.sim.journeys.offers,...this.sim.journeys.history].find(goal=>goal?.id===id);
        if(!goal)return;const facts=onlineJourneyFacts(this.sim,this.surface,this.exploration);
        this.closePanel();this.panel='map';this.worldMap.open({x:this.sim.expeditions.location?this.sim.expeditions.surfaceX:this.sim.player.x,y:this.sim.expeditions.location?this.sim.expeditions.surfaceY:this.sim.player.y,angle:0});
        this.worldMap.focusJourney(publicJourneyMarker(goal,facts.discovered(goal.id)||goal.finishedAt!==undefined));
      },
    });
    this.client=new OnlineClient(ticket,snapshot=>this.snapshot(snapshot),(status,connected)=>{
      this.connected=connected;const label=app.querySelector<HTMLElement>('#online-connection');if(label){label.textContent=status;label.dataset.connected=String(connected);}
      if(!connected)this.clearInput();
    });
    this.touch=new TouchHUD(app.querySelector<HTMLElement>('.online-game')!,{
      activate:active=>{
        this.input.clear();this.padInput.clear();
        if(active||!this.usingGamepad)this.gamepad.clear();
        this.renderer.touchActive=active;if(active)this.usingGamepad=false;
        if(this.touch)this.resize();
      },
      clearAttack:()=>this.command({type:'clearCombat'}),cancelCombat:()=>this.command({type:'clearCombat'}),
      unlock:()=>{void this.audio.unlock().catch(()=>{});},notice:message=>this.toast(message),
      menu:action=>{
        if(action==='pause')this.openMenu();
        else if(action==='character'||action==='inventory'){this.openPanel('inventory');this.inventory.openTouchTab(action==='character'?'stats':'bag');}
        else if(action==='skills')this.openPanel('skills');
        else if(action==='journeys')this.openJourneys();else if(action==='map')this.openMap();
        else if(action==='portal')this.homePortal();else if(action==='interact')this.interact();
      },
    });
    const menuButton=this.touch.element.querySelector<HTMLButtonElement>('[data-touch-menu="pause"]')!;
    menuButton.setAttribute('aria-label','Menu da sala');menuButton.querySelector('.touch-icon')!.textContent='⋯';
    bindTouchCanvas(this.canvas,signal,{
      enabled:()=>this.touch.active&&!this.panel&&this.connected,pan:()=>{},
      start:()=>this.command({type:'clearCombat'}),
      zoom:scale=>this.renderer.zoomByWheel(-Math.log(scale)/.0016,0,this.canvas.getBoundingClientRect().height),
      tap:point=>{const rect=this.canvas.getBoundingClientRect();this.interactAt(point.x*this.renderer.width/rect.width,point.y*this.renderer.height/rect.height);},
    });
    app.querySelector('#online-resume-game')!.addEventListener('click',()=>this.closePanel(),{signal});
    app.querySelector('#online-open-menu')!.addEventListener('click',()=>this.openMenu(),{signal});
    app.querySelector('#online-sound')!.addEventListener('click',()=>this.toggleSound(),{signal});
    const fullscreen=app.querySelector<HTMLButtonElement>('#online-fullscreen')!;
    fullscreen.hidden=!document.fullscreenEnabled;
    fullscreen.addEventListener('click',()=>{void(document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen()).catch(()=>this.toast('Tela cheia indisponível.'));},{signal});
    app.querySelector('#online-copy')!.addEventListener('click',()=>{
      const url=new URL('/online.html',location.origin);url.hash=new URLSearchParams({room:ticket.room,invite:ticket.invite}).toString();
      const copy=navigator.clipboard?.writeText(url.href)??Promise.reject(new Error('Clipboard unavailable'));
      void copy.then(()=>this.toast('Convite copiado.'),()=>{
        this.toast('Copie o convite abaixo.');const field=document.createElement('input');field.className='online-invite-field';field.value=url.href;field.readOnly=true;
        app.querySelector('.online-invite-field')?.remove();
        app.querySelector('#online-menu')!.append(field);field.focus();field.select();
      });
    },{signal});
    app.querySelector('#online-leave')!.addEventListener('click',()=>{
      void this.client.post('leave',{}).then(()=>{saveTicket(null);history.replaceState(null,'',location.pathname);showLobby();},()=>showLobby('A sala está sem conexão. Use Retomar minha partida para tentar novamente.'));
    },{signal});
    app.querySelector('#online-inventory')!.addEventListener('click',()=>this.openPanel('inventory'),{signal});
    app.querySelector('#online-skills')!.addEventListener('click',()=>this.openPanel('skills'),{signal});
    app.querySelector('#online-map')!.addEventListener('click',()=>this.openMap(),{signal});
    app.querySelector('#online-journeys')!.addEventListener('click',()=>this.openJourneys(),{signal});
    app.querySelector('#online-players')!.addEventListener('click',()=>{
      this.closePanel();
      const list=app.querySelector<HTMLElement>('#online-party')!;list.hidden=!list.hidden;
      app.querySelector('#online-players')!.setAttribute('aria-expanded',String(!list.hidden));
    },{signal});
    app.querySelector('#online-home')!.addEventListener('click',()=>this.homePortal(),{signal});
    app.querySelector('#online-exit')!.addEventListener('click',()=>this.command({type:'dungeon',kind:'exit'}),{signal});
    app.querySelector('#online-revive')!.addEventListener('click',()=>this.command({type:'revive'}),{signal});
    this.canvas.addEventListener('contextmenu',event=>event.preventDefault(),{signal});
    window.addEventListener('pointermove',event=>{
      if(event.pointerType==='touch')return;
      this.input.movePointer(event.clientX,event.clientY,this.canvas.getBoundingClientRect(),this.renderer.width,this.renderer.height);
      if(this.input.setPointerUIBlocked(document.elementFromPoint(event.clientX,event.clientY)!==this.canvas))this.command({type:'clearCombat'});
      if(event.isTrusted){this.usingGamepad=false;this.padInput.clear();}
    },{signal});
    this.canvas.addEventListener('pointerdown',event=>{
      if(event.pointerType==='touch'||this.panel)return;
      this.canvas.focus();void this.audio.unlock();
      this.usingGamepad=false;this.padInput.clear();
      this.input.movePointer(event.clientX,event.clientY,this.canvas.getBoundingClientRect(),this.renderer.width,this.renderer.height);
      if(event.button===0&&this.interactAt(this.input.pointer.x,this.input.pointer.y))return;
      this.input.pointerDown(event.button);
    },{signal});
    window.addEventListener('pointerup',event=>this.input.pointerUp(event.button),{signal});
    window.addEventListener('keydown',event=>{
      if((event.target as HTMLElement)?.closest('input,textarea,select'))return;
      if(event.code==='Escape'){event.preventDefault();if(!event.repeat)this.panel?this.closePanel():this.openMenu();return;}
      if(event.code==='KeyN'){if(!event.repeat)this.toggleSound();return;}
      if(event.code==='KeyI'||event.code==='KeyC'){event.preventDefault();if(!event.repeat)this.openPanel('inventory');return;}
      if(event.code==='KeyT'){event.preventDefault();if(!event.repeat)this.openPanel('skills');return;}
      if(controls.action(event.code)==='journeys'){event.preventDefault();if(!event.repeat)this.openJourneys();return;}
      if(controls.action(event.code)==='map'){event.preventDefault();if(!event.repeat)this.openMap();return;}
      if(controls.action(event.code)==='portal'){event.preventDefault();if(!event.repeat)this.homePortal();return;}
      if(this.panel)return;
      if(controls.action(event.code)==='interact'){event.preventDefault();if(!event.repeat)this.interact();return;}
      if(controls.action(event.code)){event.preventDefault();this.usingGamepad=false;this.padInput.clear();this.touch.setActive(false);this.input.keyDown(event.code);}
    },{signal});
    window.addEventListener('keyup',event=>this.input.keyUp(event.code),{signal});
    window.addEventListener('blur',()=>this.clearInput(),{signal});
    document.addEventListener('visibilitychange',()=>{this.clearInput();this.audio.setForeground(!document.hidden);},{signal});
    this.canvas.addEventListener('wheel',event=>{event.preventDefault();this.renderer.zoomByWheel(event.deltaY,event.deltaMode,innerHeight);},{signal,passive:false});
    window.addEventListener('resize',()=>this.resize(),{signal});
    window.visualViewport?.addEventListener('resize',()=>this.resize(),{signal});
    this.resize();this.canvas.focus();this.client.connect();
    this.inputTimer=setInterval(()=>this.sendInput(),1000/30);
    this.frame=requestAnimationFrame(now=>this.render(now));
  }
  private toast(message:string):void {
    const toast=app.querySelector<HTMLElement>('#online-toast');if(toast){toast.textContent=message;toast.hidden=false;}
    clearTimeout(this.toastTimer);this.toastTimer=setTimeout(()=>{if(toast)toast.hidden=true;},6000);
  }
  private command(value:unknown):void {
    if(!this.connected){this.toast('Aguarde a conexão com a sala.');return;}
    void this.client.post('command',value).catch(error=>this.toast((error as Error).message));
  }
  private clearInput():void{this.input.clear();this.gamepad.clear();this.padInput.clear();this.gamepadMenu.clear();this.touch?.clear();}
  private closePanel():void {
    this.inventory.close();this.skills.close();this.service.close();this.events.close();this.rifts.close();this.expeditions.close();this.worldMap.close();this.dungeonMap.close();this.journeys.close();
    app.querySelector<HTMLElement>('#online-menu')!.hidden=true;this.panel=null;this.clearInput();this.canvas.focus();
  }
  private openMenu():void{const previous=this.panel;this.closePanel();if(previous==='menu')return;this.panel='menu';app.querySelector<HTMLElement>('#online-menu')!.hidden=false;}
  private toggleSound():void{this.audio.setEnabled(!this.audio.enabled);app.querySelector('#online-sound')!.textContent=this.audio.enabled?'Som ligado':'Som desligado';}
  private minimapRect(){const rect=getMinimapRect(this.renderer.width,this.renderer.height);return {...rect,y:this.touch?.active?this.touch.minimapTop*this.renderer.height/Math.max(1,visualViewport?.height??innerHeight):rect.y};}
  private interactAt(x:number,y:number):boolean{
    const map=this.minimapRect();
    if(x>=map.x&&y>=map.y&&x<map.x+map.width&&y<map.y+map.height){this.openMap();return true;}
    if(!this.touch.active&&isHUDPoint(x,y,this.renderer.width,this.renderer.height)){
      const menu=getHUDLayout(this.renderer.width,this.renderer.height).shortcuts[0];
      if(x>=menu.x&&y>=menu.y&&x<=menu.x+menu.width&&y<=menu.y+menu.height)this.openMenu();
      return true;
    }
    const loot=hoveredGroundLoot(this.renderer.groundLootLabels,x,y);
    if(loot){this.command({type:'pickup',id:loot.id});return true;}
    const point=this.renderer.screenToWorld(x,y);return this.openService(point)||this.openEvent(point);
  }
  private interact():void{
    if(this.openService()||this.openEvent())return;
    const p=this.sim.player,item=this.sim.groundItems.filter(item=>Math.hypot(item.x-p.x,item.y-p.y)<120).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];
    if(item)this.command({type:'pickup',id:item.id});
  }
  private openJourneys(id?:string):void{
    if(!this.lastSnapshot)return;const previous=this.panel;this.closePanel();if(previous==='journeys'&&!id)return;
    this.panel='journeys';this.journeys.update(this.sim.journeys,onlineJourneyFacts(this.sim,this.surface,this.exploration),false,this.renderer.width,this.renderer.height,dungeonJourney(this.sim.expeditions,this.sim.dungeonFloor));this.journeys.open(id);
  }
  private openMap():void{
    if(!this.lastSnapshot)return;
    const previous=this.panel;this.closePanel();if(previous==='map')return;this.panel='map';
    const run=currentDungeon(this.sim.expeditions);
    if(run&&this.sim.dungeonFloor)this.dungeonMap.open(this.sim.dungeonFloor,run,this.sim.player,false,this.sim.enemies);
    else this.worldMap.open(this.sim.player);
  }
  private homePortal():void{
    if(!this.lastSnapshot||this.sim.player.dead)return;
    if(this.sim.portal.active){this.command({type:'portalCancel'});return;}
    this.closePanel();const link=this.sim.travel.returnTo;
    if(link&&this.world===this.surface&&this.world.isSanctuary(this.sim.player.x,this.sim.player.y)&&!withinPortalReach(this.sim.player,this.surface.getPortalAnchor(link.town),this.world)){this.openMap();return;}
    this.command({type:link&&withinPortalReach(this.sim.player,this.surface.getPortalAnchor(link.town),this.world)?'portalReturn':'portalStart'});
  }
  private openEvent(pointer?:{x:number;y:number}):boolean {
    if(this.sim.dungeonFloor){
      const floor=this.sim.dungeonFloor,p=this.sim.player,run=currentDungeon(this.sim.expeditions)!;
      const event=floor.events?.find(event=>Math.hypot(event.x-p.x,event.y-p.y)<=75&&!run.events?.[event.id]?.started);
      if(event){this.command({type:'dungeonEvent',id:event.id});return true;}
      if([floor.entry,dungeonRunExit(floor,run)].some(point=>Math.hypot(point.x-p.x,point.y-p.y)<=75)){
        this.command({type:'dungeon',kind:'exit'});return true;
      }
      return false;
    }
    const anchor=this.surface.getSettlements(this.sim.player.x-150,this.sim.player.y-150,300,300).map(townPortalAnchor)
      .find(anchor=>withinPortalReach(this.sim.player,anchor,this.world)&&(!pointer||Math.hypot(pointer.x-anchor.x,pointer.y-(anchor.y-25))<42));
    if(anchor){this.command({type:this.sim.travel.returnTo?.town===anchor.band?'portalReturn':'setHome'});return true;}
    const p=this.sim.player,building=this.world.getBuildings(p.x-180,p.y-180,360,360)
      .filter(b=>(b.kind==='rift'||b.kind==='expedition')&&Math.hypot(p.x-b.door.x,p.y-b.door.y)<=90
        &&(!pointer||Math.hypot(pointer.x-(b.x+b.width/2),pointer.y-(b.y+b.height/2))<Math.max(b.width,b.height)))
      .sort((a,b)=>Math.hypot(p.x-a.door.x,p.y-a.door.y)-Math.hypot(p.x-b.door.x,p.y-b.door.y))[0];
    if(building){
      this.closePanel();
      if(building.kind==='rift'){this.panel='rift';this.rifts.open(this.sim.expeditions,p,building.id);}
      else{this.panel='expedition';this.expeditions.open(this.sim.expeditions,p.level,this.surface.seed,building.id);}return true;
    }
    const entrance=this.world.getDungeonEntrances(this.sim.player.x-160,this.sim.player.y-160,320,320)
      .find(entrance=>Math.hypot(entrance.x-this.sim.player.x,entrance.y-this.sim.player.y)<=75
        &&(!pointer||Math.hypot(pointer.x-entrance.x,pointer.y-entrance.y)<60));
    if(entrance){this.closePanel();this.panel='event';this.events.openDungeon(entrance);return true;}
    const sites=eventInteractionSites(this.world.getEventSites(p.x-1200,p.y-1200,2400,2400),this.sim.eventState,this.world);
    const site=focusEvent(sites,p,this.world,pointer);if(!site)return false;
    this.closePanel();this.panel='event';this.events.open(site);return true;
  }
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
    const blocked=!!this.panel||document.hidden||!document.hasFocus();
    const input=blocked?idleInput():this.touch.active?this.directionInput():this.usingGamepad?this.padInput.consume():this.mouseInput();
    this.sending=true;this.sequence=Math.max(Date.now(),this.sequence+1);
    void this.client.post('input',{sequence:this.sequence,input,blocked,viewport:this.renderer.combatViewport,exclusion:this.renderer.spawnExclusionBounds(this.sim.player)})
      .catch(()=>{}).finally(()=>{this.sending=false;});
  }
  private mouseInput():Input{
    const pointer=this.input.pointer,aim=this.renderer.screenToWorld(pointer.x,pointer.y);
    const blocked=isHUDPoint(pointer.x,pointer.y,this.renderer.width,this.renderer.height);
    const input=this.input.consume(aim,blocked),p=this.sim.player;
    const id=input.skillSlot!==null?p.character.skillSlots[input.skillSlot]:null;
    const weapon=id?skillWeapon(id,p.equipment)??basicAttackWeapon(p):basicAttackWeapon(p);
    const assisted=this.renderer.resolvePointerAim(this.sim,this.world,pointer.x,pointer.y,pointer.present,weapon);
    return assisted?{...input,rangedAim:{x:assisted.x,y:assisted.y}}:input;
  }
  private directionInput():Input{
    const p=this.sim.player,touch=this.touch.input,pad=this.gamepad;
    if(!this.touch.active){
      if(pad.aim.x||pad.aim.y){this.padAngle=Math.atan2(pad.aim.y,pad.aim.x);this.padDistance=60+Math.hypot(pad.aim.x,pad.aim.y)*220;}
      else if(pad.move.x||pad.move.y)this.padAngle=Math.atan2(pad.move.y,pad.move.x);
    }
    const angle=this.padAngle??p.angle,raw={x:p.x+Math.cos(angle)*this.padDistance,y:p.y+Math.sin(angle)*this.padDistance};
    const input=this.touch.active?touch.consume(raw):pad.gameplay(raw);
    const slot=this.touch.active?touch.aimingSlot??input.skillSlot:input.skillSlot,id=slot!==null?p.character.skillSlots[slot]:null;
    const weapon=id?skillWeapon(id,p.equipment)??basicAttackWeapon(p):basicAttackWeapon(p),range=deriveAttackStats(p.stats,weapon).range;
    const recipe=id?resolveSkill(id,p.derived,p.character).recipe:null;
    let aim=this.touch.active?{x:p.x+touch.aim.x*Math.min(900,range)*touch.distance,y:p.y+touch.aim.y*Math.min(900,range)*touch.distance}:raw;
    if(recipe?.kind==='ground')aim=skillTargetPoint(this.world,p,aim,range);
    const assisted=this.renderer.resolveDirectionAim(this.sim,this.world,aim,directionalAimProfile(range,weapon.attackKind,recipe));
    if(assisted)aim=assisted;
    const screen=this.renderer.worldToScreen(aim.x,aim.y);Object.assign(this.input.pointer,screen,{present:true});
    return {...input,aimX:aim.x,aimY:aim.y,...(assisted?{rangedAim:{x:assisted.x,y:assisted.y}}:{})};
  }
  private pollGamepad(now:number):void{
    let pads:(Gamepad|null)[]=[];try{pads=navigator.getGamepads?[...navigator.getGamepads()]:[];}catch{/* Host can deny this API. */}
    const pad=this.gamepad;pad.poll(pads,this.connected&&document.hasFocus()&&!document.hidden);
    if(pad.disconnected&&this.usingGamepad){this.clearInput();this.usingGamepad=false;this.toast('Controle desconectado.');return;}
    if(pad.active&&!this.usingGamepad){this.input.clear();this.usingGamepad=true;this.touch.setActive(false);this.usingGamepad=true;this.padAngle=this.sim.player.angle;}
    if(pad.pressed.size)void this.audio.unlock().catch(()=>{});
    if(pad.pressed.has(PAD.pause)||(this.panel&&pad.pressed.has(PAD.dodge))){
      if(this.panel==='inventory'&&this.inventory.dismissPopup())return;
      if(this.panel==='skills'&&this.skills.dismissPopup())return;
      this.panel?this.closePanel():this.openMenu();return;
    }
    if(this.sim.player.dead){this.gamepadMenu.update(app.querySelector<HTMLElement>('#online-death')!,pad,now);return;}
    if(this.panel){
      if(this.panel==='inventory')this.inventory.updateGamepad(pad,now);
      else if(this.panel==='skills')this.skills.updateGamepad(pad,now);
      else this.gamepadMenu.update(app.querySelector<HTMLElement>('#online-panels')!,pad,now);
      return;
    }
    if(pad.pressed.has(PAD.map)){this.openMap();return;}
    if(pad.pressed.has(PAD.up)){this.openPanel('skills');return;}
    if(pad.pressed.has(PAD.left)||pad.pressed.has(PAD.right)){this.openPanel('inventory');return;}
    if(pad.pressed.has(PAD.down)){this.homePortal();return;}
    if(pad.pressed.has(PAD.interact)){this.interact();if(this.panel)return;}
    if(this.usingGamepad)this.padInput.push(this.directionInput());
  }
  private snapshot(snapshot:OnlineSnapshot):void {
    if(snapshot.version!==ONLINE_VERSION){this.toast('Atualize a página para usar a versão atual.');this.client.dispose();return;}
    if(this.lastSnapshot&&snapshot.tick<=this.lastSnapshot.tick)return;
    const own=snapshot.players.find(member=>member.id===snapshot.self);if(!own)return;
    const old=this.lastSnapshot;
    if((old?.location?.id??null)!==(snapshot.location?.id??null)){
      this.closePanel();const previous=this.world;
      if(snapshot.location){const floor=generateDungeon(snapshot.location.seed,snapshot.location.level,snapshot.location);
        this.world=snapshot.location.rift?new RiftWorld(floor,snapshot.location):new DungeonWorld(floor,snapshot.location);this.sim.dungeonFloor=floor;
      }else{this.world=this.surface;this.sim.dungeonFloor=null;}
      this.sim.world=this.world;this.renderer.reset();if(previous!==this.surface)previous.dispose();
    }
    this.sim.expeditions=snapshot.expeditions;
    if(snapshot.journeys)this.sim.journeys=snapshot.journeys;
    this.sim.clearedCampProjection=new Set(snapshot.clearedCamps);
    if(snapshot.chart&&this.exploration.restore(snapshot.chart))this.exploration.storageStatus='saved';
    // Retain the previous delivered positions, rather than a 120 Hz position that
    // is only a fraction of a network frame away from the current position.
    const position=(next:{x:number;y:number;prevX:number;prevY:number},before?:{x:number;y:number})=>{
      const smooth=before&&Math.hypot(next.x-before.x,next.y-before.y)<400;
      next.prevX=smooth?before.x:next.x;next.prevY=smooth?before.y:next.y;
    };
    for(const member of snapshot.players)position(member.player,old?.players.find(p=>p.id===member.id)?.player);
    for(const enemy of snapshot.enemies)position(enemy,old?.enemies.find(e=>e.id===enemy.id));
    for(const shot of snapshot.projectiles)position(shot,old?.projectiles.find(p=>p.id===shot.id));
    for(const key of Object.keys(this.sim.player))if(!Object.hasOwn(own.player,key))Reflect.deleteProperty(this.sim.player,key);
    Object.assign(this.sim.player,own.player);this.sim.time=snapshot.time;this.sim.enemies=snapshot.enemies;this.sim.projectiles=snapshot.projectiles;
    this.sim.groundEffects=snapshot.groundEffects;this.sim.chains=snapshot.chains;this.sim.pickups=snapshot.pickups;
    this.sim.groundItems=snapshot.groundItems;this.sim.groundGold=snapshot.groundGold;
    this.sim.eventState=snapshot.eventState;
    this.sim.travel=own.travel;this.sim.portal.origin=own.portal?.origin??null;this.sim.portal.elapsed=own.portal?.elapsed??0;
    if(own.channel){this.sim.eventChannel.start(own.channel.site,own.channel.choice);this.sim.eventChannel.elapsed=own.channel.elapsed;}
    else this.sim.eventChannel.cancel();
    this.sim.brokenContainers.clear();for(const id of snapshot.brokenContainers)this.sim.brokenContainers.add(id);
    this.world.setBrokenContainers(this.sim.brokenContainers);
    this.companions=snapshot.players.filter(member=>member.id!==snapshot.self&&member.connected).map(member=>member.player);
    if(!old||old.location?.id!==snapshot.location?.id)this.renderer.snapTo(this.sim.player);
    const events=snapshot.events.filter(({player,event})=>!personalEvents.has(event.type)||player===snapshot.self).map(record=>record.event);
    this.renderer.handleEvents(events,this.reducedMotion);for(const event of events)this.audio.play(event);
    for(const event of events)if(event.type==='notice')this.toast(event.message);
    const party=JSON.stringify(snapshot.players.map(member=>[member.id,member.connected,member.player.level,member.player.dead]));
    if(party!==this.lastParty){
      this.lastParty=party;
      app.querySelector('#online-party')!.innerHTML=snapshot.players.map(member=>`<li class="${member.id===snapshot.self?'self':''}"><span>${escapeUI(member.player.name??'Viajante')}</span><small>Nv. ${member.player.level} · ${member.player.dead?'Caído':member.connected?'Na sala':'Reconectando'}</small></li>`).join('');
    }
    app.querySelector<HTMLElement>('#online-death')!.hidden=!this.sim.player.dead;
    app.querySelector<HTMLElement>('#online-revive')!.textContent=snapshot.location?'Voltar à entrada':'Voltar ao acampamento';
    app.querySelector<HTMLElement>('#online-exit')!.hidden=!snapshot.location;
    if(this.sim.player.dead&&this.panel)this.closePanel();
    if(this.panel==='inventory')this.inventory.refresh(this.sim.player);if(this.panel==='skills')this.skills.refresh(this.sim.player);
    const facts=onlineJourneyFacts(this.sim,this.surface,this.exploration),goal=pinnedJourney(this.sim.journeys);
    const marker=goal?publicJourneyMarker(goal,goal.finishedAt!==undefined||facts.discovered(goal.id)):null;
    this.worldMap.setJourneyMarker(marker);this.dungeonMap.marker=dungeonJourney(this.sim.expeditions,this.sim.dungeonFloor)?.marker??null;
    this.journeys.update(this.sim.journeys,facts,!this.panel,this.renderer.width,this.renderer.height,dungeonJourney(this.sim.expeditions,this.sim.dungeonFloor));
    this.receivedAt=performance.now();this.lastSnapshot=snapshot;
  }
  private resize():void {
    const viewport=presentationViewport({width:innerWidth,height:innerHeight,visualHeight:visualViewport?.height??innerHeight,devicePixelRatio:devicePixelRatio||1,touchActive:!!this.touch?.active,profile:this.presentation});
    this.canvas.width=viewport.worldBufferWidth;this.canvas.height=viewport.worldBufferHeight;
    this.ui.width=viewport.uiBufferWidth;this.ui.height=viewport.uiBufferHeight;this.renderer.resize(viewport.logicalWidth,viewport.logicalHeight);
    this.renderer.cursorPixelScale={x:viewport.logicalWidth/viewport.width,y:viewport.logicalHeight/viewport.height};
    this.touch?.refreshLayout();this.renderer.touchViewport=this.touch?.viewport??null;
    this.renderer.touchTopInset=(this.touch?.safeTop??0)*viewport.logicalHeight/viewport.height;
    this.journeys.resize(viewport.logicalWidth,viewport.logicalHeight);
  }
  private render(now:number):void {
    const dt=Math.min(.1,(now-this.previous)/1000);this.previous=now;
    this.pollGamepad(now);
    if(this.lastSnapshot){
      this.touch.update(this.sim.player,this.panel?'paused':'playing',!this.connected,now,this.sim.groundEffects);
      const preview=!!this.touch.input.preview;if(preview&&!this.touchPreview)this.command({type:'clearCombat'});this.touchPreview=preview;
      this.renderer.gamepadActive=this.usingGamepad;
      const destinations=portalDestinations({seed:this.surface.seed,home:this.surface.getPortalAnchor(this.sim.travel.homeTown),travel:this.sim.travel,expeditions:this.sim.expeditions});
      this.renderer.portalDestinations=destinations;
      const link=this.sim.travel.returnTo,returnReach=!!link&&this.world===this.surface&&withinPortalReach(this.sim.player,this.surface.getPortalAnchor(link.town),this.world);
      const mode=portalActionMode(this.sim.portal.active,this.world.isSanctuary(this.sim.player.x,this.sim.player.y),!!destinations.returnTo,returnReach);
      this.touch.setPortal({mode,progress:this.sim.portal.active?this.sim.portal.progress:null,destination:(mode==='locate'||mode==='return'?destinations.returnTo:null)??destinations.home});
      const alpha=Math.min(1,(now-this.receivedAt)/(1000/15));
      const settings:RenderSettings={phase:'playing',reducedMotion:this.reducedMotion,companions:this.companions,interpolationAlpha:alpha,showGroundLootNames:true};
      this.renderer.pointerX=this.input.pointer.x;this.renderer.pointerY=this.input.pointer.y;this.renderer.pointerActive=this.input.pointer.present&&!this.panel;
      this.renderer.render(this.sim,this.world,dt,settings);this.fx.render(this.renderer.canvas,this.renderer.hurt,this.renderer.emission);
      this.ctx.setTransform(1,0,0,1,0,0);this.ctx.clearRect(0,0,this.ui.width,this.ui.height);
      this.ctx.setTransform(this.ui.width/this.renderer.width,0,0,this.ui.height/this.renderer.height,0,0);this.renderer.renderUI(this.ctx,this.sim,this.world,settings);
      const run=currentDungeon(this.sim.expeditions);if(run?.rift)drawRiftHUD(this.ctx,run,this.renderer.width);
      this.ctx.save();this.ctx.translate(0,this.minimapRect().y-getMinimapRect(this.renderer.width,this.renderer.height).y);
      if(run&&this.sim.dungeonFloor){
        drawCryptMinimap(this.ctx,this.sim.dungeonFloor,run,this.sim.player,this.renderer.width,this.renderer.height,null,this.sim.time,this.sim.enemies);
        if(this.panel==='map')this.dungeonMap.update(this.sim.player,this.sim.enemies,run);
      }else{
        this.worldMap.update(this.sim.player,dt);this.worldMap.drawMinimap(this.ctx,this.sim.player,this.renderer.width,this.renderer.height,this.sim.time,this.sim.enemies);
      }
      const chart=getMinimapChartRect(getMinimapRect(this.renderer.width,this.renderer.height));
      for(const companion of this.companions){
        const point=projectMapPoint(companion.x,companion.y,{...chart,centerX:this.sim.player.x,centerY:this.sim.player.y,zoom:run?.entrance? .095:.05});
        if(point.x>chart.x&&point.x<chart.x+chart.width&&point.y>chart.y&&point.y<chart.y+chart.height){
          this.ctx.fillStyle=companion.dead?'#bd8277':'#98dbc5';this.ctx.beginPath();this.ctx.arc(point.x,point.y,3,0,Math.PI*2);this.ctx.fill();
        }
      }
      this.ctx.restore();
      for(const companion of this.companions){
        const x=companion.prevX+(companion.x-companion.prevX)*alpha,y=companion.prevY+(companion.y-companion.prevY)*alpha;
        const point=this.renderer.worldToScreen(x,y-70);text(this.ctx,companion.name??'Viajante',point.x,point.y,.8,'#b9dfcc','center');
      }
    }
    this.frame=requestAnimationFrame(stamp=>this.render(stamp));
  }
  dispose():void {
    this.abort.abort();this.client.dispose();clearInterval(this.inputTimer);clearTimeout(this.toastTimer);cancelAnimationFrame(this.frame);
    this.touch.dispose();this.inventory.dispose();this.skills.dispose();this.service.dispose();this.events.dispose();this.rifts.dispose();this.expeditions.dispose();this.worldMap.dispose();this.dungeonMap.dispose();this.journeys.dispose();this.exploration.dispose();this.renderer.reset();this.fx.dispose();this.audio.dispose();this.world.dispose();if(this.world!==this.surface)this.surface.dispose();
  }
}

void loadGameFont().then(()=>showLobby(),()=>showLobby('Não foi possível carregar as fontes locais. Recarregue a página para tentar novamente.'));
if(import.meta.hot)import.meta.hot.dispose(()=>{game?.dispose();game=undefined;});
