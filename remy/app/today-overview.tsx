"use client";
import { useMemo } from 'react';
import { Flame, Footprints, Moon, Utensils } from 'lucide-react';
import { summarize, type Entry } from '@/lib/domain';
import { recoveryContext, recoveryForDate } from '@/lib/recovery-context';
import { milesFromMeters } from '@/lib/run-distance';
import styles from './journal-layout.module.css';
const amount=(n:number|null|undefined,unit='')=>n==null?'—':`${n.toLocaleString('en-US',{maximumFractionDigits:1})}${unit}`;
export function TodayOverview({records,date,onAdjust,onConnections}:{records:Entry[];date:string;onAdjust:()=>void;onConnections:()=>void}) {
 const summary=useMemo(()=>summarize(records,date),[records,date]);
 const recovery=recoveryForDate(records,date,summary.profile.timezone,summary.generatedAt).selected;
 const runs=summary.workouts.filter(r=>/run|treadmill/i.test(r.data.sport));
 const knownDistance=runs.filter(r=>r.data.distanceMeters!=null),knownDuration=runs.filter(r=>r.data.durationSec!=null);
 const distance=knownDistance.length?milesFromMeters(knownDistance.reduce((n,r)=>n+r.data.distanceMeters!,0)):null;
 const minutes=knownDuration.length?knownDuration.reduce((n,r)=>n+r.data.durationSec!,0)/60:null;
 const cycles=summary.recovery.map(entry=>recoveryContext(entry,date,summary.profile.timezone,summary.generatedAt));
 const displayCycle=recovery??(cycles.length===1?cycles[0]:null);
 const burn=displayCycle?.expenditureKcal??null,scale=Math.max(summary.totals.calories??0,burn??0,1);
 const clock=(instant:string|null)=>instant?new Intl.DateTimeFormat('en-US',{timeZone:summary.profile.timezone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(instant)):'ongoing';
 return <div className={styles.overview}>
  <section className={`card ${styles.energy}`}>
   <div className={styles.sectionHead}><h2>Food & energy</h2><button className="text-button" onClick={onAdjust}>Daily target</button></div>
   <div className={styles.energyPair}>
    <div><span><Utensils size={15}/>Food logged</span><strong>{amount(summary.totals.calories)}<small>kcal</small></strong>
     {summary.totals.calories!=null&&<div className={styles.energyTrack}><i style={{width:`${summary.totals.calories/scale*100}%`}}/></div>}
     <p>{summary.nutritionSource==='historical-summary'?'Historical daily estimate':summary.meals.length?`${summary.meals.length} meals · ${summary.day.complete?'logging complete':'logged so far'}${summary.nutrientCoverage.calories.known<summary.meals.length?` · ${summary.nutrientCoverage.calories.known}/${summary.meals.length} calorie estimates known`:''}`:'No food logged yet'}</p>
    </div>
    <div><span><Flame size={15}/>Estimated burn</span><strong>{amount(burn)}<small>kcal</small></strong>
     {burn!==null&&<div className={`${styles.energyTrack} ${styles.burnTrack}`}><i style={{width:`${burn/scale*100}%`}}/></div>}
     <p>{displayCycle?.cycleMetricsScope==='ongoing-cycle'?'WHOOP cycle · in progress':displayCycle?'WHOOP physiological cycle':cycles.length>1?'Multiple WHOOP periods; see below':'WHOOP estimate unavailable'}</p>
    </div>
   </div>
   {displayCycle&&<p className={styles.period}>{clock(displayCycle.start)} → {clock(displayCycle.end)} · {summary.profile.timezone}</p>}
   <p className={styles.smallNote}>Food is a calendar-day log; WHOOP estimates cover the period shown. Workout calories are not added again. This is not an exact energy balance.</p>
   {cycles.length>1&&<details className={styles.smallDetails}><summary>{cycles.length} WHOOP periods touch this date</summary><dl>{cycles.map(c=><div key={c.id} id={c.id}><dt>{clock(c.start)} → {clock(c.end)}{c.cycleMetricsScope==='after-selected-period'?' · ends after this date':c.cycleMetricsScope==='ongoing-cycle'?' · in progress':''}</dt><dd>{amount(c.expenditureKcal,' kcal')}</dd></div>)}</dl></details>}
   <div className={styles.macros}>{(['protein','carbs','fat','fiber'] as const).map(key=><div key={key}><span>{key==='carbs'?'Carbohydrate':key}</span><strong>{amount(summary.totals[key])}<small>g</small></strong><small>{summary.nutritionSource==='historical-summary'?'Source estimate':summary.nutrientCoverage[key].known<summary.meals.length?`${summary.nutrientCoverage[key].known}/${summary.meals.length} meals known`:'Recorded amount'}{key==='protein'?' · usual priority 120–135 g':''}</small></div>)}</div>
  </section>
  <section className={`card ${styles.movement}`}>
   <div className={styles.sectionHead}><h2><Footprints size={18}/>Running & recovery</h2></div>
   <div className={styles.runHeadline}><strong>{amount(distance)}<small>mi</small></strong><span>{minutes==null?'No recorded run duration':`${amount(minutes)} minutes`}{runs.length>1?` · ${runs.length} runs`:''}</span></div>
   {runs.length>0&&(knownDistance.length<runs.length||knownDuration.length<runs.length)&&<p className={styles.smallNote}>Known distance for {knownDistance.length}/{runs.length} runs · duration for {knownDuration.length}/{runs.length}. Totals are partial.</p>}
   {runs.length?<div className={styles.runList}>{runs.map(run=><div id={run.id} key={run.id}><strong>{run.data.title}</strong><span>{run.source==='strava'?'Strava':'Recorded run'} · {amount(run.data.distanceMeters==null?null:milesFromMeters(run.data.distanceMeters),' mi')} · {amount(run.data.durationSec==null?null:run.data.durationSec/60,' min')}{run.data.avgHr!=null?` · ${amount(run.data.avgHr)} bpm`:''}</span></div>)}</div>:<p className={styles.smallNote}>No run is recorded for this date. <button className="text-button" onClick={onConnections}>Check connections</button></p>}
   <div className={styles.recoveryPair}><div><span>WHOOP recovery</span><strong>{amount(recovery?.recovery,'%')}</strong></div><div><span><Moon size={12}/>Sleep</span><strong>{amount(recovery?.sleepHours,' h')}</strong></div></div>
   {recovery&&<p className={styles.smallNote}>{recovery.dateBasis==='sleep-completion'?`Sleep ended ${recovery.sleepCompletedLocal}.`:'Sleep completion time is missing; this date is provisional.'}</p>}
   {summary.plans[0]&&<div className={styles.nextRun}><small>UP NEXT · {summary.plans[0].localDate}</small><strong>{summary.plans[0].data.title}</strong><span>{amount(summary.plans[0].data.durationSec==null?null:summary.plans[0].data.durationSec/60,' min')} · {summary.plans[0].data.intensity||'Effort unspecified'}</span></div>}
  </section>
 </div>;
}
