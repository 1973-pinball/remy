export const CALCULATION_VERSION = 'remy-1.1.0';
export const NUTRITION_SOURCE = 'https://www.dietitians.ca/DietitiansOfCanada/media/Documents/Resources/noap-position-paper.pdf';
export type Kind='profile'|'meal'|'workout'|'plan'|'recovery'|'day'|'connection'|'import'|'message'|'proposal'|'savedMeal';
export interface Entry<T=Record<string,unknown>>{id:string;kind:Kind;localDate:string|null;source:string;sourceId:string;revision:number;updatedAt:string;data:T;deleted?:boolean}
export interface Profile{name:string;timezone:string;baseline:number;baselineIncludes:string;weightKg:number|null;raceDate:string|null;goalMinutes:number|null;diet:string;weightGoal:string;confirmed:boolean;gutTolerance:string;carbBands:{light:[number,number];moderate:[number,number];high:[number,number]}}
export interface Nutrients{calories:number|null;carbs:number|null;protein:number|null;fat:number|null;fiber:number|null}
export const ETL_FIELDS=['rawVegetablesG','cookedVegetablesG','beansG','soyG','fruitServings','starchCups','nutsSeedsG','flaxG','avocadoG','driedFruitG','flexCalories','runFuelCalories'] as const;
export type EtlField=typeof ETL_FIELDS[number];
export type EtlIntake=Partial<Record<EtlField,number|null>>;
export interface Meal extends Nutrients{title:string;mealType:string;mealTime:string|null;messageTime:string|null;notes:string;confidence:'label'|'recipe'|'estimate'|'unknown';workoutId:string|null;photoId?:string|null;etl?:EtlIntake}
export interface Workout{title:string;start:string;durationSec:number|null;distanceMeters:number|null;avgHr:number|null;calories:number|null;elevationMeters:number|null;sport:string;notes:string;sourceRefs?:string[];laps?:unknown[];streams?:unknown;perceivedEffort?:number|null;soreness?:number|null}
export interface Plan{title:string;start:string|null;allDay:boolean;durationSec:number|null;distanceMeters:number|null;intensity:string;notes:string;completedWorkoutId:string|null;originalDate?:string;cancelled?:boolean}
export interface Recovery{start:string;end:string|null;scoreState:string;kilojoules:number|null;recovery:number|null;hrv:number|null;restingHr:number|null;sleepHours:number|null;strain:number|null}
export interface Day{complete:boolean;adjustment:number;adjustmentReason:string;feedback:string;weightKg?:number|null}
export const DEFAULT_PROFILE:Profile={name:'',timezone:'America/New_York',baseline:2300,baselineIncludes:'Not yet established',weightKg:null,raceDate:null,goalMinutes:null,diet:'',weightGoal:'',confirmed:false,gutTolerance:'Not yet established',carbBands:{light:[3,5],moderate:[5,7],high:[6,10]}};
export const emptyDay:Day={complete:false,adjustment:0,adjustmentReason:'',feedback:''};
export function localDate(instant:string|Date=new Date(),timezone='America/New_York'){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(instant));return `${parts.find(p=>p.type==='year')!.value}-${parts.find(p=>p.type==='month')!.value}-${parts.find(p=>p.type==='day')!.value}`}
export function addDays(date:string,n:number){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
export function zonedInstant(dateTime:string,zone:string){
 if(/(?:Z|[+-]\d\d:\d\d)$/.test(dateTime))return new Date(dateTime).toISOString();
 const wall=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dateTime)?dateTime+':00':dateTime;
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(wall))throw new Error('Use a valid local date and time, or include an explicit UTC offset.');
 const target=Date.parse(wall+'Z');if(!Number.isFinite(target)||new Date(target).toISOString().slice(0,19)!==wall)throw new Error('Invalid local date or time.');
 const formatter=new Intl.DateTimeFormat('sv-SE',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 const localWall=(instant:number)=>formatter.format(new Date(instant)).replace(' ','T');
 // Consider the offsets on both sides of a transition. A repeated wall time
 // has two valid instants; an absent spring-forward time has none.
 const offsets=new Set<number>();for(let hours=-36;hours<=36;hours+=6){const instant=target+hours*3_600_000;offsets.add(Date.parse(localWall(instant)+'Z')-instant)}
 const matches=[...offsets].map(offset=>target-offset).filter(instant=>localWall(instant)===wall);
 if(matches.length!==1)throw new Error('This local time is ambiguous or does not exist. Supply an explicit UTC offset.');
 return new Date(matches[0]).toISOString();
}
export function dayBounds(date:string,zone:string){return{start:zonedInstant(date+'T00:00:00',zone),end:zonedInstant(addDays(date,1)+'T00:00:00',zone)}}
export function profileOf(entries:Entry[]):Profile{return {...DEFAULT_PROFILE,...entries.find(e=>e.kind==='profile'&&!e.deleted)?.data} as Profile}
export function ofKind<T>(entries:Entry[],kind:Kind){return entries.filter(e=>e.kind===kind&&!e.deleted) as Entry<T>[]}
export const round=(n:number)=>Math.round(n*10)/10;
export function sumNutrients(meals:Entry<Meal>[]){const result={} as Nutrients;for(const k of ['calories','carbs','protein','fat','fiber'] as const){const values=meals.map(m=>m.data[k]).filter((v):v is number=>v!=null);result[k]=values.length?round(values.reduce((a,b)=>a+b,0)):null}return result}
export function summarize(entries:Entry[],date:string,options:{now?:string}={}){
 const now=options.now??new Date().toISOString(),profile=profileOf(entries),bounds=dayBounds(date,profile.timezone);
 const contextStart=localDate(now,profile.timezone)===date?Date.parse(now):Date.parse(bounds.start),contextEnd=contextStart+48*3_600_000;
 const meals=ofKind<Meal>(entries,'meal').filter(m=>m.localDate===date),workouts=ofKind<Workout>(entries,'workout').filter(w=>w.localDate===date);
 const plans=ofKind<Plan>(entries,'plan').filter(p=>{
  if(p.data.cancelled||p.data.completedWorkoutId||!p.localDate)return false;
  if(p.data.start){const time=Date.parse(p.data.start);return time>=contextStart&&time<contextEnd}
  const window=dayBounds(p.localDate,profile.timezone);return Date.parse(window.start)<contextEnd&&Date.parse(window.end)>contextStart;
 }).sort((a,b)=>(a.data.start??a.localDate!).localeCompare(b.data.start??b.localDate!));
 const day={...emptyDay,...ofKind<Day>(entries,'day').find(d=>d.localDate===date)?.data},totals=sumNutrients(meals),minutes=workouts.reduce((n,w)=>n+(w.data.durationSec??0)/60,0),nextLong=plans.find(p=>(p.data.durationSec??0)>=90*60||/long/i.test(p.data.title));
 const band: 'light'|'moderate'|'high' = minutes>=90||!!nextLong?'high':minutes>=45||plans.some(p=>(p.data.durationSec??0)>=45*60)?'moderate':'light';
 const weight=profile.confirmed?profile.weightKg:null,ref=profile.carbBands[band],range=weight?[Math.round(weight*ref[0]),Math.round(weight*ref[1])]:null;
 const recovery=ofKind<Recovery>(entries,'recovery').filter(r=>Date.parse(r.data.start)<Date.parse(bounds.end)&&Date.parse(r.data.end??now)>Date.parse(bounds.start));
 const inputEntries=entries.filter(e=>!e.deleted&&(e.kind==='profile'||(e.kind==='day'&&e.localDate===date)||meals.some(m=>m.id===e.id)||workouts.some(w=>w.id===e.id)||plans.some(p=>p.id===e.id)||recovery.some(r=>r.id===e.id)));
 const inputs=inputEntries.map(e=>({id:e.id,revision:e.revision,date:e.localDate,kind:e.kind,updatedAt:e.updatedAt}));
 const fingerprint=inputs.map(e=>`${e.id}:${e.revision}`).sort().join('|');
 const nutrientCoverage=Object.fromEntries((['calories','carbs','protein','fat','fiber'] as const).map(k=>[k,{known:meals.filter(m=>m.data[k]!=null).length,total:meals.length,complete:meals.length>0&&meals.every(m=>m.data[k]!=null)}])) as Record<keyof Nutrients,{known:number;total:number;complete:boolean}>;
 const etl=Object.fromEntries(ETL_FIELDS.map(k=>{const known=meals.map(m=>m.data.etl?.[k]).filter((n):n is number=>n!=null);return[k,{value:known.length?round(known.reduce((a,b)=>a+b,0)):null,known:known.length,total:meals.length,complete:meals.length>0&&known.length===meals.length}]})) as Record<EtlField,{value:number|null;known:number;total:number;complete:boolean}>;
 const limitations=[!day.complete?'Food logging is incomplete; unlogged intake is unknown.':null,!weight?'Confirm your current body weight to personalize carbohydrate ranges.':null,meals.some(m=>Object.keys(nutrientCoverage).some(k=>m.data[k as keyof Nutrients]==null))?'Some meals have missing nutrition values; displayed sums include only known values.':null,!workouts.length?'No completed activity is recorded for this date.':null,!plans.length?'No upcoming workouts are available in the next 48 hours.':null,plans.some(p=>!p.data.start)?'Some planned sessions have a date but no time; their 48-hour context is approximate.':null,recovery.length?'WHOOP expenditure covers physiological cycles, which may differ from the food-log day. These estimates are not an exact daily energy balance.':null].filter(Boolean) as string[];
 const reason=nextLong?`${nextLong.data.title} on ${nextLong.localDate} raises the carbohydrate context for today.`:minutes>=90?'Recorded endurance training is at least 90 minutes.':band==='moderate'?'Recorded or upcoming training includes a session of at least 45 minutes.':'Available records suggest a light training day; missing sessions can change this context.';
 return{version:CALCULATION_VERSION,date,generatedAt:now,profile,day,meals,workouts,plans,recovery,totals,nutrientCoverage,etl,target:profile.baseline+day.adjustment,baseline:profile.baseline,adjustment:day.adjustment,band,carbs:{range,reference:ref,gramsPerKg:weight&&totals.carbs!=null?round(totals.carbs/weight):null,remaining:range&&totals.carbs!=null?range.map(n=>Math.max(0,round(n-totals.carbs!))):null,reason},expenditure:recovery.map(r=>({id:r.id,start:r.data.start,end:r.data.end,kcal:r.data.scoreState==='SCORED'&&r.data.kilojoules!=null?Math.round(r.data.kilojoules/4.184):null,estimated:true,period:'WHOOP physiological cycle'})),inputs,fingerprint,limitations,nextLong,context:{start:new Date(contextStart).toISOString(),end:new Date(contextEnd).toISOString()}};
}
export function fuelingPlan(plan:Plan,profile:Profile){const min=(plan.durationSec??0)/60;return{before:min>60&&profile.confirmed&&profile.weightKg?[profile.weightKg,profile.weightKg*4]:null,beforeTiming:'1–4 hours before exercise; choose the amount and timing you tolerate.',during:min>150?[30,90]:min>=60?[30,60]:null,after:'Include carbohydrate and protein in your next meal. Rapid refueling is especially relevant when another demanding session is less than 8 hours away.',note:min>150?'Up to 90 g/hour is a reference, not a required starting rate. Higher rates need prior gut practice and suitable carbohydrate sources.':plan.durationSec==null?'Duration is missing, so an hourly fueling range has not been calculated.':'Practice your plan in training; adjust for gut tolerance.',reference:NUTRITION_SOURCE}}
export function weeklyTraining(entries:Entry[],date:string){const d=new Date(date+'T12:00:00Z'),start=addDays(date,-((d.getUTCDay()+6)%7)),end=addDays(start,6),runs=ofKind<Workout>(entries,'workout').filter(w=>w.localDate!>=start&&w.localDate!<=end&&/run/i.test(w.data.sport));const meters=runs.reduce((n,r)=>n+(r.data.distanceMeters??0),0),long=Math.max(0,...runs.map(r=>r.data.distanceMeters??0));return{start,end,runs,km:round(meters/1000),count:runs.length,days:new Set(runs.map(r=>r.localDate)).size,longRunKm:round(long/1000),longRunShare:meters?Math.round(long/meters*100):null,missingDistance:runs.filter(r=>r.data.distanceMeters==null).length}}
export function matchWorkout(incoming:Workout,existing:Entry<Workout>[]){const sport=(s:string)=>/run|treadmill/i.test(s)?'running':s.toLowerCase();return existing.filter(e=>!e.deleted&&sport(e.data.sport)===sport(incoming.sport)&&Math.abs(Date.parse(e.data.start)-Date.parse(incoming.start))<60_000&&e.data.durationSec!=null&&incoming.durationSec!=null&&Math.abs(e.data.durationSec-incoming.durationSec)<Math.max(30,incoming.durationSec*.03)&&(e.data.distanceMeters==null||incoming.distanceMeters==null||Math.abs(e.data.distanceMeters-incoming.distanceMeters)<Math.max(100,incoming.distanceMeters*.03)))}
