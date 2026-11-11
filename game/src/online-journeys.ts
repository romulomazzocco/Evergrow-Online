import { currentDungeon } from './dungeon-state.ts';
import { getZoneAt } from './zone-progression.ts';
import { captureEncounterScale } from './encounter-scaling.ts';
import { JourneySearch, reconcileJourneys, journeyNeedsRefresh, type JourneyFacts } from './journey-director.ts';
import { activityLevel } from './activity-level.ts';
import type { Simulation } from './simulation.ts';
import type { WorldLandscape } from './world-landscape.ts';
import type { Exploration } from './exploration.ts';

/** The server and journal project the same facts; only the server runs searches and rewards. */
export function onlineJourneyFacts(sim:Simulation,surface:WorldLandscape,exploration:Exploration):JourneyFacts{
  const p=sim.player,origin=currentDungeon(sim.expeditions)?.entrance??p,area=getZoneAt(origin.x,origin.y,surface.seed);
  return {areaId:area.id,areaName:area.name,areaLevel:captureEncounterScale(area,p.level).base,x:p.x,y:p.y,level:p.level,time:sim.time,
    events:sim.eventState,expeditions:sim.expeditions,encounterScale:id=>sim.encounterScale(id)??sim.expeditions.surface?.encounterScales?.[id],
    discovered:id=>{
      const goal=[sim.journeys.nearestTown,sim.journeys.townPin,...sim.journeys.accepted,...sim.journeys.offers,...sim.journeys.history].find(goal=>goal?.id===id);
      return goal?.kind==='frontier'?exploration.isRevealed(goal.x,goal.y):exploration.isDiscovered(id);
    },campCleared:id=>sim.getCampState(id)==='cleared'||!!sim.expeditions.surface?.clearedCamps.includes(id)};
}
export class OnlineJourneyScheduler{
  private checkedAt=-1;
  private search:JourneySearch|null=null;
  private sim:Simulation;private surface:WorldLandscape;private exploration:Exploration;
  constructor(sim:Simulation,surface:WorldLandscape,exploration:Exploration){this.sim=sim;this.surface=surface;this.exploration=exploration;}
  update():void{
    const sim=this.sim,p=sim.player;if(p.dead)return;
    const facts=onlineJourneyFacts(sim,this.surface,this.exploration);
    const safe=!sim.dungeonFloor&&!p.attack&&p.castTime<=0&&!sim.eventChannel.site&&!sim.portal.active
      &&!sim.enemies.some(enemy=>enemy.hp>0&&Math.hypot(enemy.x-p.x,enemy.y-p.y)<550&&['chase','windup','attack'].includes(enemy.state));
    if(sim.dungeonFloor)this.search=null;
    if(this.search&&safe){
      if(Math.hypot(p.x-this.search.origin.x,p.y-this.search.origin.y)>1200)this.search=null;
      else if(this.search.step()){
        sim.journeys={...sim.journeys,...this.search.result(sim.journeys,facts),areaId:facts.areaId,refreshedAt:sim.time,level:p.level,x:p.x,y:p.y};this.search=null;
      }
    }
    if(this.checkedAt>=0&&sim.time-this.checkedAt<.5)return;
    this.checkedAt=sim.time;
    if(!sim.dungeonFloor){
      const towns=this.surface.getSettlements(p.x-260,p.y-260,520,520);
      for(const goal of [...sim.journeys.accepted,...sim.journeys.offers,...towns.map(town=>{
        const zone=getZoneAt(town.x,town.y,this.surface.seed);
        return {settlementTier:town.kind,id:town.id,kind:'town' as const,name:town.name,x:town.x,y:town.y,level:captureEncounterScale(zone,p.level).base,region:zone.name};
      })])sim.completeJourneyArrival(goal);
      facts.level=p.level;
    }
    sim.journeys=reconcileJourneys(sim.journeys,facts,safe||!!sim.dungeonFloor&&!sim.enemies.some(enemy=>enemy.hp>0&&Math.hypot(enemy.x-p.x,enemy.y-p.y)<550));
    if(safe&&!this.search&&journeyNeedsRefresh(sim.journeys,facts))this.search=new JourneySearch(this.surface,facts,this.exploration.getDiscoveredPOIs({x:p.x-3600,y:p.y-3600,width:7200,height:7200}));
    const origin=currentDungeon(sim.expeditions)?.entrance??p,town=this.surface.getNearestSettlement(origin.x,origin.y),zone=getZoneAt(town.x,town.y,this.surface.seed);
    sim.journeys.nearestTown={settlementTier:town.kind,id:town.id,kind:'town',name:town.name,x:town.x,y:town.y,level:captureEncounterScale(zone,p.level).base,region:zone.name};
    for(const list of [sim.journeys.accepted,sim.journeys.offers])for(const goal of list)if(goal.finishedAt===undefined)goal.level=activityLevel(goal,facts,this.surface.seed);
  }
}
