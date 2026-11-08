import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Simulation } from '../src/simulation.ts';
import { WorldLandscape } from '../src/world-landscape.ts';
import { createCharacterSheet, isStarterLoadoutId } from '../src/items.ts';
import { refreshCharacter } from '../src/character.ts';
import { executeCharacterCommand, type CharacterCommand } from '../src/character-commands.ts';
import { EQUIPMENT_SLOTS } from '../src/items.ts';
import { SKILL_DEFINITIONS } from '../src/skill-content.ts';
import { planService, type ServiceQuote } from '../src/commerce.ts';
import { buildingNPC, canInteractNPC } from '../src/npcs.ts';
import { normalizePackLayout } from '../src/inventory-grid.ts';
import { treasureLanding } from '../src/treasure-flight.ts';
import { addGroundItem } from '../src/ground-loot.ts';
import type { CharacterSheet } from '../src/character-types.ts';
import { LOOT_RULES } from '../src/combat-content.ts';
import type { CombatViewport } from '../src/combat-visibility.ts';
import { idleInput, ONLINE_LIMITS, ONLINE_VERSION, object, type OnlineSnapshot, type RoomTicket } from '../src/online-protocol.ts';
import type { Input } from '../src/model.ts';
import type { CharacterCheckpoint } from '../src/character-save.ts';

const secret = () => randomBytes(24).toString('base64url');
export function equalSecret(a: string, b: unknown): boolean {
  return typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
export interface OnlineMember {
  id: string; token: string; sim: Simulation; input: Input; sequence: number; inputAt: number; seenAt: number; connected: boolean;
  viewport?: CombatViewport; exclusion?: CombatViewport;
}
export interface SavedRoom {
  version: 1; id: string; invite: string; seed: number; tick: number; savedAt: number;
  checkpoint: CharacterCheckpoint;
  members: { id: string; token: string; name: string; checkpoint: CharacterCheckpoint }[];
}
export class OnlineRoom {
  readonly id: string;
  readonly invite: string;
  readonly seed: number;
  readonly world: WorldLandscape;
  readonly sim: Simulation;
  readonly members = new Map<string, OnlineMember>();
  tick = 0;
  lastActive = Date.now();
  private pendingEvents: OnlineSnapshot['events'] = [];

  constructor(seed: number, identity = { id: randomBytes(9).toString('base64url'), invite: secret() }) {
    this.id = identity.id; this.invite = identity.invite; this.seed = seed;
    this.world = new WorldLandscape(seed);
    this.sim = new Simulation(this.world, { seed });
  }
  join(name: string, loadout: string, now = Date.now()): RoomTicket {
    if (this.members.size >= ONLINE_LIMITS.players) throw new Error('Esta sala está cheia.');
    if (!name.trim() || name.trim().length > 24 || !isStarterLoadoutId(loadout)) throw new Error('Nome ou equipamento inválido.');
    const sim = new Simulation(this.world, { seed: this.seed });
    sim.player.character = createCharacterSheet(loadout); refreshCharacter(sim.player);
    sim.player.hp = sim.player.maxHp; sim.player.mana = sim.player.maxMana; sim.player.name = name.trim();
    const member: OnlineMember = { id: randomUUID(), token: secret(), sim, input: idleInput(), sequence: -1, inputAt: 0, seenAt: now, connected: false };
    this.members.set(member.id, member); this.lastActive = now;
    this.world.setBrokenContainers(this.sim.brokenContainers);
    return this.ticket(member);
  }
  ticket(member: OnlineMember): RoomTicket {
    return { version: ONLINE_VERSION, room: this.id, invite: this.invite, seed: this.seed, player: member.id, token: member.token };
  }
  authenticate(token: unknown): OnlineMember | undefined {
    return [...this.members.values()].find(member => equalSecret(member.token, token));
  }
  input(member: OnlineMember, input: Input, sequence: number, now = Date.now()): boolean {
    if (!Number.isSafeInteger(sequence) || sequence <= member.sequence) return false;
    // Preserve action edges if two packets arrive before the next simulation tick.
    member.input = { ...input, dodge: input.dodge || member.input.dodge, heal: input.heal || member.input.heal,
      skillSlot: input.skillSlot ?? member.input.skillSlot };
    member.sequence = sequence; member.inputAt = member.seenAt = now;
    return true;
  }
  camera(member: OnlineMember, viewport: unknown, exclusion: unknown): void {
    const checked=(value:unknown):CombatViewport|undefined=>{
      const view=object(value),p=member.sim.player;
      if(!view||!['x','y','width','height'].every(key=>typeof view[key]==='number'&&Number.isFinite(view[key])))return;
      const {x,y,width,height}=view as unknown as CombatViewport;
      if(width<320||height<240||width>8192||height>8192||p.x<x-512||p.y<y-512||p.x>x+width+512||p.y>y+height+512)return;
      return {x,y,width,height};
    };
    member.viewport=checked(viewport);member.exclusion=checked(exclusion);
  }
  advance(now = Date.now()): void {
    const active = [...this.members.values()].filter(member => member.connected);
    if (!active.length) return;
    this.lastActive = now;
    for (const member of active) {
      const p = member.sim.player;
      member.sim.setCombatViewport(member.viewport ?? { x: p.x-480, y: p.y-300, width: 960, height: 600 });
      const view = (m: OnlineMember) => {
        const v=m.exclusion??m.viewport??{x:m.sim.player.x-1300,y:m.sim.player.y-900,width:2600,height:1800};
        return {x:v.x-250,y:v.y-250,width:v.width+500,height:v.height+500};
      };
      member.sim.setSpawnExclusion({ ...view(member), others: active.filter(m=>m!==member).map(view) });
      if (now-member.inputAt > ONLINE_LIMITS.inputAge) { member.input = idleInput(); member.sim.clearInput(); }
    }
    this.sim.updateCooperative(active.map(member => ({ sim: member.sim, input: member.input })));
    this.tick++;
    for (const member of active) {
      const input = member.input;
      member.input = { ...input, dodge: false, heal: false, skillSlot: null };
      this.pendingEvents.push(...member.sim.drainEvents().map(event => ({ player: member.id, event })));
    }
    this.pendingEvents.push(...this.sim.drainEvents().map(event => ({ player: null, event })));
    // Slow/absent stream consumers cannot grow the event queue without bound.
    if (this.pendingEvents.length > 512) this.pendingEvents.splice(0, this.pendingEvents.length-512);
  }
  frame(): Omit<OnlineSnapshot, 'self'> {
    const sims = [...this.members.values()].map(member => member.sim);
    const events = this.pendingEvents; this.pendingEvents = [];
    return { version: ONLINE_VERSION, tick: this.tick, time: this.sim.time,
      players: [...this.members.values()].map(member => ({ id: member.id, connected: member.connected, player: member.sim.player })),
      enemies: this.sim.enemies, projectiles: [...this.sim.projectiles, ...sims.flatMap(sim => sim.projectiles)],
      groundEffects: sims.flatMap(sim => sim.groundEffects), chains: sims.flatMap(sim => sim.chains),
      pickups: this.sim.pickups, groundItems: this.sim.groundItems, groundGold: this.sim.groundGold,
      brokenContainers: [...this.sim.brokenContainers], events };
  }
  command(member: OnlineMember, value: unknown): { ok: boolean; message?: string; character?: CharacterSheet } {
    const v = object(value), sim = member.sim;
    if (!v || typeof v.type !== 'string') return { ok: false, message: 'Comando inválido.' };
    if (v.type === 'revive') {
      if (!sim.player.dead) return { ok: false };
      // Revive resets only this player's runtime. Shared enemies/loot stay owned by the room.
      sim.revive(); this.world.setBrokenContainers(this.sim.brokenContainers); return { ok: true };
    }
    if (sim.player.dead) return { ok: false, message: 'Volte ao acampamento primeiro.' };
    if (v.type === 'pickup' && Number.isSafeInteger(v.id)) {
      sim.groundItems = this.sim.groundItems;
      const message = sim.requestGroundItem(Number(v.id)); return { ok: !message, ...(message ? { message } : {}) };
    }
    const integer = (key: string, max: number) => Number.isInteger(v[key]) && Number(v[key]) >= 0 && Number(v[key]) <= max;
    const slot = (key: string) => typeof v[key] === 'string' && EQUIPMENT_SLOTS.includes(v[key] as typeof EQUIPMENT_SLOTS[number]);
    const skill = () => typeof v.skill === 'string' && Object.hasOwn(SKILL_DEFINITIONS, v.skill);
    if (v.type === 'service') {
      const q=object(v.quote),request=object(q?.request),source=object(request?.source);
      const natural=(value:unknown,max=10000)=>Number.isInteger(value)&&Number(value)>=0&&Number(value)<=max;
      const itemSource=source&&(natural(source.bag,119)||typeof source.equipped==='string'&&EQUIPMENT_SLOTS.includes(source.equipped as typeof EQUIPMENT_SLOTS[number]));
      let valid=false;
      if(q&&request&&typeof q.npcId==='string'&&q.npcId.length<200&&['revision','epoch','itemRevision','price'].every(key=>Number.isSafeInteger(q[key])&&Number(q[key])>=0)&&typeof q.itemId==='string')switch(request.type){
        case 'refreshStock':case 'resetAttributes':case 'respec':valid=true;break;
        case 'buy':case 'retrieve':valid=natural(request.slot,4095);break;
        case 'store':valid=natural(request.bag,119)&&(request.tab===undefined||natural(request.tab,15));break;
        case 'unlockStorage':valid=natural(request.tab,15);break;
        case 'buyback':valid=typeof request.id==='string'&&request.id.length<200;break;
        case 'sell':valid=!!itemSource;break;
        case 'sellMany':valid=Array.isArray(request.items)&&request.items.length<=120&&request.items.every(entry=>{
          const item=object(entry);return item&&natural(item.bag,119)&&typeof item.id==='string'&&item.id.length<200&&natural(item.revision);
        })&&(request.includeActiveCharms===undefined||typeof request.includeActiveCharms==='boolean');break;
        case 'gamble':valid=['weapon','shield','head','chest','gloves','legs','boots','cloak','ring','amulet','grimoire','orb','charm'].includes(String(request.kind));break;
        case 'improve':valid=!!itemSource&&['enhance','rarity','rerollOne','rerollAll','relevel'].includes(String(request.operation))
          &&(request.affix===undefined||natural(request.affix,30))&&(request.focus===undefined||['any','offense','defense','utility'].includes(String(request.focus)));break;
      }
      if(!valid)return {ok:false,message:'Oferta inválida.'};
      const p=sim.player,npc=this.world.getBuildings(p.x-200,p.y-200,400,400).map(buildingNPC).find(npc=>npc?.id===q!.npcId);
      if(!npc||!canInteractNPC(npc,p,this.world))return {ok:false,message:'O serviço não está ao seu alcance.'};
      const plan=planService(p.character,npc,p.level,q as unknown as ServiceQuote);
      if(!plan.ok)return plan;
      p.character=plan.character;refreshCharacter(p);
      if(request?.type==='respec'){p.skillCooldowns={};p.affixBuffs=undefined;p.skillEffects=undefined;}
      return {ok:true,message:plan.message,character:p.character};
    }
    if(v.type==='drop'){
      const source=object(v.source),sheet=sim.player.character;
      const item=source?.type==='bag'&&Number.isInteger(source.index)&&Number(source.index)>=0&&Number(source.index)<120?sheet.inventory[Number(source.index)]
        :source?.type==='equipment'&&typeof source.slot==='string'&&EQUIPMENT_SLOTS.includes(source.slot as typeof EQUIPMENT_SLOTS[number])?sheet.equipped[source.slot as typeof EQUIPMENT_SLOTS[number]]:null;
      if(!item||item.id!==source?.id||item.locked)return {ok:false,message:'O item mudou ou está bloqueado.'};
      if(this.sim.groundItems.length>=LOOT_RULES.maxGroundItems)return {ok:false,message:'Recolha os itens próximos antes de deixar outro no chão.'};
      const character=structuredClone(sheet),id=this.sim.nextEntityIdentity;
      const landing=treasureLanding(this.world,sim.player.x,sim.player.y,id,item.seed);
      if(source.type==='bag')character.inventory[Number(source.index)]=null;else character.equipped[source.slot as typeof EQUIPMENT_SLOTS[number]]=null;
      if(character.inventoryLayout)delete character.inventoryLayout[item.id];
      character.recentItems=character.recentItems?.filter(value=>value!==item.id);normalizePackLayout(character);
      // Starter and vendor recipes have character-local IDs. Give a transferred
      // instance a room identity so another character can own an identical recipe.
      const transferred=structuredClone(item);transferred.id=`online:${this.id}:${id}`;
      if(transferred.shield)transferred.shield.id=transferred.id;
      if(transferred.focus)transferred.focus.id=transferred.id;
      addGroundItem(this.sim.groundItems,{id,item:transferred,...landing,flight:{x:sim.player.x,y:sim.player.y,at:this.sim.time,delay:0}});
      this.sim.reserveIdentity(id+1);sim.player.character=character;refreshCharacter(sim.player);
      return {ok:true};
    }
    let valid = false;
    switch (v.type) {
      case 'equip': valid = integer('index',119) && (v.slot === undefined || slot('slot')); break;
      case 'unequip': valid = slot('slot') && (v.index === undefined || integer('index',119)); break;
      case 'moveItem': valid = integer('from',119) && integer('to',119); break;
      case 'allocateAttribute': valid = ['strength','dexterity','intelligence','vitality'].includes(String(v.attribute)); break;
      case 'allocateNode': case 'chooseDoctrine': valid = typeof v.id === 'string' && v.id.length < 120; break;
      case 'refundNode': {
        const chain=object(v.chain);
        valid=typeof v.id==='string'&&v.id.length<120&&(v.chain===undefined||!!chain&&Array.isArray(chain.nodeIds)&&chain.nodeIds.length<=2000
          &&chain.nodeIds.every(id=>typeof id==='string'&&id.length<120)&&Number.isInteger(chain.points)&&Number(chain.points)>0);break;
      }
      case 'equipBest': valid=v.choice===undefined||['check','replace','keep'].includes(String(v.choice));break;
      case 'sortStorage': valid=v.tab===undefined||integer('tab',15);break;
      case 'assignSkill': valid = integer('slot',4) && (v.skill === null || skill()); break;
      case 'upgradeSkill': valid = skill(); break;
      case 'configureSkill': valid = skill() && integer('rank',20) && (v.specialization === null || typeof v.specialization === 'string' && v.specialization.length < 100); break;
      case 'respecSkills': valid = integer('points',10000); break;
      case 'overload': valid = typeof v.enabled === 'boolean'; break;
      case 'lockItem': valid = typeof v.id === 'string' && v.id.length < 120 && typeof v.locked === 'boolean'; break;
      case 'sortInventory': valid = ['rarity','type','recent','compact'].includes(String(v.mode)); break;
    }
    if (!valid) return { ok: false, message: 'Comando inválido.' };
    return executeCharacterCommand(sim.player, v as unknown as CharacterCommand);
  }
  save(now = Date.now()): SavedRoom {
    return { version: 1, id: this.id, invite: this.invite, seed: this.seed, tick: this.tick, savedAt: now,
      checkpoint: this.sim.captureCheckpoint(), members: [...this.members.values()].map(member => ({ id: member.id,
        token: member.token, name: member.sim.player.name ?? 'Viajante', checkpoint: member.sim.captureCheckpoint() })) };
  }
  static restore(saved: SavedRoom): OnlineRoom {
    const room = new OnlineRoom(saved.seed, saved);
    room.tick = saved.tick; room.lastActive = saved.savedAt; room.sim.restoreCheckpoint(saved.checkpoint);
    for (const entry of saved.members) {
      const sim = new Simulation(room.world, { seed: saved.seed });
      sim.restoreCheckpoint(entry.checkpoint); sim.player.name = entry.name;
      room.members.set(entry.id, { id: entry.id, token: entry.token, sim, input: idleInput(), sequence: -1, inputAt: 0, seenAt: saved.savedAt, connected: false });
    }
    room.world.setBrokenContainers(room.sim.brokenContainers);
    return room;
  }
  dispose(): void { this.world.dispose(); }
}
