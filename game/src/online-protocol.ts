import type { Input, Player, Enemy, Projectile, CombatEvent, Pickup } from './model.ts';
import type { GroundItem } from './character-types.ts';
import type { GroundGold } from './gold.ts';
import type { ActiveGroundEffect } from './ground-effects.ts';
import type { ChainFlight } from './chain-lightning.ts';
import type { EventState, EventSite, EventChoice } from './poi-content.ts';
import type { Expeditions } from './dungeon-state.ts';
import type { DungeonEntrance } from './dungeon.ts';
import type { TravelState } from './travel.ts';

export const ONLINE_VERSION = 1;
export const ONLINE_LIMITS = { players: 4, rooms: 32, inputAge: 600, reconnect: 120_000, body: 256*1024, snapshot:16*1024*1024 } as const;
export const idleInput = (): Input => ({ moveX: 0, moveY: 0, aimX: 0, aimY: 0, attack: false, dodge: false, heal: false, skillSlot: null });
export interface RoomTicket { version: number; room: string; invite: string; player: string; token: string; seed: number; }
export interface OnlineSnapshot {
  version: number; tick: number; time: number; self: string;
  players: { id: string; connected: boolean; player: Player; travel:TravelState; portal?:{origin:{x:number;y:number};elapsed:number}; channel?: {site:EventSite;choice:EventChoice|null;elapsed:number} }[];
  enemies: Enemy[]; projectiles: Projectile[]; groundEffects: ActiveGroundEffect[]; chains: ChainFlight[];
  pickups: Pickup[]; groundItems: GroundItem[]; groundGold: GroundGold[]; brokenContainers: string[];
  events: { player: string | null; event: CombatEvent }[];
  eventState: EventState;
  location: DungeonEntrance | null;
  expeditions: Expeditions;
  chart?: string;
  clearedCamps:string[];
}
export function encodeOnline(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => v instanceof Set ? { $set: [...v] } : v);
}
/** Only server snapshots use this codec. Incoming client commands stay plain JSON. */
export function decodeOnline<T>(value: string): T {
  return JSON.parse(value, (_key, v: unknown) => v && typeof v === 'object' && '$set' in v
    && Array.isArray(v.$set) ? new Set(v.$set) : v) as T;
}
export function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export function validInput(value: unknown): Input | null {
  const v = object(value);
  if (!v || !['moveX','moveY','aimX','aimY'].every(key => typeof v[key] === 'number' && Number.isFinite(v[key]))
    || Math.abs(v.moveX as number) > 1 || Math.abs(v.moveY as number) > 1
    || Math.abs(v.aimX as number) > 1e7 || Math.abs(v.aimY as number) > 1e7
    || !['attack','dodge','heal'].every(key => typeof v[key] === 'boolean')
    || v.skillSlot !== null && (!Number.isInteger(v.skillSlot) || Number(v.skillSlot) < 0 || Number(v.skillSlot) > 4)) return null;
  if (v.heldSkillSlots !== undefined && (!Array.isArray(v.heldSkillSlots) || v.heldSkillSlots.length > 5
    || !v.heldSkillSlots.every(slot => Number.isInteger(slot) && slot >= 0 && slot <= 4))) return null;
  return { moveX: Number(v.moveX), moveY: Number(v.moveY), aimX: Number(v.aimX), aimY: Number(v.aimY),
    attack: v.attack === true, dodge: v.dodge === true, heal: v.heal === true, skillSlot: v.skillSlot as number | null,
    ...(Array.isArray(v.heldSkillSlots) ? { heldSkillSlots: v.heldSkillSlots as number[] } : {}), skillPressed: v.skillPressed !== false };
}
