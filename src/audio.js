import {noteToMidi} from './lib/jianpu.js';
import {pianoSampleForMidi} from './lib/piano.js';
import {ticksToSeconds} from './lib/rhythmPlayback.js';
import {envelopePoints,STOP_PADDING_SECONDS} from './lib/envelope.js';

// All scheduled sound and cursor callbacks belong to a cancellable generation.
// Pausing, changing range and loading a new plan invalidate even pending sample loads.
export class PianoPlayer {
  key='1=E4'; context=null; buffers=new Map(); sources=new Set(); timers=new Set(); generation=0;
  stats={scheduled:0,cancelled:0,loops:0,decoded:0};
  async unlock(){this.context??=new AudioContext();if(this.context.state==='suspended')await this.context.resume();}
  stop(){this.generation++;for(const t of this.timers)clearTimeout(t);this.timers.clear();for(const s of this.sources){try{s.stop();}catch{}}this.stats.cancelled+=this.sources.size;this.sources.clear();}
  later(fn,ms,g){const t=setTimeout(()=>{this.timers.delete(t);if(g===this.generation)fn();},Math.max(0,ms));this.timers.add(t);}
  async sample(midi){const spec=pianoSampleForMidi(midi);if(!this.buffers.has(spec.url)){const p=fetch(spec.url).then(r=>{if(!r.ok)throw Error('钢琴音源载入失败，请重试');return r.arrayBuffer();}).then(b=>this.context.decodeAudioData(b)).then(b=>{this.stats.decoded++;return b;}).catch(e=>{this.buffers.delete(spec.url);throw e;});this.buffers.set(spec.url,p);}return {spec,buffer:await this.buffers.get(spec.url)};}
  async play(plan,notes,{onNote,onDone,onReady,midiForStep}){
    this.stop();const g=this.generation;await this.unlock();
    const resolveMidi=typeof midiForStep==='function'?midiForStep:(index)=>noteToMidi(notes[index],this.key);
    const startAt=step=>Number.isFinite(step.startSeconds)?step.startSeconds:ticksToSeconds(step.startTicks,plan.tempo);
    const durationOf=step=>Number.isFinite(step.soundDurationSeconds)?step.soundDurationSeconds:ticksToSeconds(step.soundDurationTicks,plan.tempo);
    const pitches=new Map();for(const step of plan.steps)if(step.trigger){const midi=resolveMidi(step.index,step);if(midi!==null)pitches.set(midi,null);}
    await Promise.all([...pitches.keys()].map(async m=>pitches.set(m,await this.sample(m))));
    if(g!==this.generation)return;
    const when=this.context.currentTime+.045;onReady?.();
    for(const step of plan.steps){
      const at=startAt(step),midi=resolveMidi(step.index,step);
      this.later(()=>onNote(step.index),(at+.045)*1000,g);
      if(!step.trigger||midi===null)continue;
      const {spec,buffer}=pitches.get(midi),source=this.context.createBufferSource(),gain=this.context.createGain();
      const duration=durationOf(step),start=when+at,shape=envelopePoints(duration),peak=spec.gain*.65;
      source.buffer=buffer;source.playbackRate.value=2**((midi-spec.sampleMidi)/12);source.connect(gain);gain.connect(this.context.destination);
      // 可听窗口正好等于时值：淡入按比例、收尾在时值处归零，比例不被固定尾巴压歪。
      gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(peak,start+shape.attack);gain.gain.setValueAtTime(peak,start+shape.sustainUntil);gain.gain.linearRampToValueAtTime(0,start+shape.end);
      source.start(start);source.stop(start+shape.end+STOP_PADDING_SECONDS);source.onended=()=>{this.sources.delete(source);source.disconnect();gain.disconnect();};this.sources.add(source);this.stats.scheduled++;
    }
    this.later(onDone,(plan.totalSeconds+.11)*1000,g);
  }
  dispose(){this.stop();this.context?.close();}
}
