import type { Input } from './model.ts';
import { idleInput } from './online-protocol.ts';

/** Rendering polls pads faster than the network sends. Retain short presses until delivery. */
export class OnlineInputBuffer {
  private latest=idleInput();
  private attack=false;private dodge=false;private heal=false;
  private skill:number|null=null;
  push(input:Input):void{
    this.latest=input;this.attack||=input.attack;this.dodge||=input.dodge;this.heal||=input.heal;
    if(input.skillSlot!==null&&input.skillPressed!==false)this.skill=input.skillSlot;
  }
  consume():Input{
    const input={...this.latest,attack:this.attack,dodge:this.dodge,heal:this.heal,
      skillSlot:this.skill??this.latest.skillSlot,skillPressed:this.skill!==null};
    this.attack=this.dodge=this.heal=false;this.skill=null;
    return input;
  }
  clear():void{this.latest=idleInput();this.attack=this.dodge=this.heal=false;this.skill=null;}
}
