import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_PROFILE,addDays,dayBounds,localDate,zonedInstant,summarize,matchWorkout,fuelingPlan,type Entry,type Kind,type Meal,type Workout,type Plan} from '../lib/domain';
import {importMeals,importCalendar,importFit,importTranscript,parseCsv,reconcileMealImport} from '../lib/imports';
import {Encoder,Profile,type FileIdMesg,type SessionMesg} from '@garmin/fitsdk';
import {gzipSync} from 'node:zlib';
import {importCommitSchema} from '../lib/validation';
import {insights} from '../lib/insights';
const now='2026-04-04T16:00:00Z',date='2026-04-04';
function entry(kind:Kind,id:string,data:object,localDateValue:string|null=date,revision=1):Entry{return{id,kind,localDate:localDateValue,source:'test',sourceId:id,revision,updatedAt:now,data:data as Record<string,unknown>}}
const meal:Meal={title:'Synthetic meal',mealType:'Lunch',mealTime:null,messageTime:null,notes:'Synthetic test fixture',confidence:'label',workoutId:null,calories:500,carbs:80,protein:20,fat:12,fiber:9};
const workout:Workout={title:'Synthetic run',start:'2026-04-04T11:00:00Z',durationSec:3600,distanceMeters:10000,avgHr:null,calories:600,elevationMeters:null,sport:'running',notes:''};
const plan:Plan={title:'Long run',start:'2026-04-05T12:00:00Z',allDay:false,durationSec:7200,distanceMeters:null,intensity:'easy',notes:'',completedWorkoutId:null};
const confirmed=entry('profile','profile',{...DEFAULT_PROFILE,confirmed:true,weightKg:70},null);

test('calorie target remains baseline plus explicit adjustment; WHOOP is not added to Garmin',()=>{
 const data=[confirmed,entry('meal','m',meal),entry('workout','w',workout),entry('day','d',{complete:false,adjustment:350,adjustmentReason:'Manual training adjustment',feedback:''}),entry('recovery','r',{start:'2026-04-04T04:00:00Z',end:'2026-04-05T04:00:00Z',scoreState:'SCORED',kilojoules:8368})];
 const result=summarize(data,date,{now});assert.equal(result.target,2650);assert.equal(result.expenditure[0].kcal,2000);assert.equal(result.totals.calories,500);assert.match(result.limitations.join(' '),/physiological cycles/);
});
test('missing or unconfirmed weight never invents personalized carbohydrate grams',()=>{
 for(const profile of [DEFAULT_PROFILE,{...DEFAULT_PROFILE,weightKg:70,confirmed:false}]){const s=summarize([entry('profile','p',profile,null),entry('meal','m',meal),entry('plan','p1',plan,'2026-04-05')],date,{now});assert.equal(s.carbs.range,null);assert.equal(s.carbs.gramsPerKg,null);assert.equal(s.carbs.remaining,null)}
});
test('confirmed synthetic weight applies the selected reference with code arithmetic',()=>{
 const s=summarize([confirmed,entry('meal','m',meal),entry('workout','w',workout)],date,{now});assert.deepEqual(s.carbs.range,[350,490]);assert.deepEqual(s.carbs.remaining,[270,410]);assert.equal(s.carbs.gramsPerKg,1.1);
});
test('unknown nutrients remain null and partial nutrient sums expose coverage',()=>{
 const s=summarize([entry('meal','m1',{...meal,calories:null,fiber:null}),entry('meal','m2',{...meal,calories:300,fiber:null})],date,{now});assert.equal(s.totals.calories,300);assert.equal(s.totals.fiber,null);assert.deepEqual(s.nutrientCoverage.calories,{known:1,total:2,complete:false});
});
test('ETL quantities are independent, nullable and do not double-count fuel calories',()=>{
 const s=summarize([entry('meal','m1',{...meal,calories:200,carbs:50,mealType:'Run fuel',workoutId:'w',etl:{runFuelCalories:200,beansG:null}}),entry('workout','w',workout)],date,{now});assert.equal(s.totals.calories,200);assert.equal(s.etl.runFuelCalories.value,200);assert.equal(s.etl.beansG.value,null);assert.equal(s.etl.rawVegetablesG.value,null);
});
test('meal revisions affect summaries and insight fingerprints without duplicate rows',()=>{
 const first=[confirmed,entry('meal','m',meal)],second=[confirmed,entry('meal','m',{...meal,calories:400,carbs:60},date,2)];assert.equal(summarize(second,date,{now}).totals.calories,400);assert.notEqual(insights(first,date,{now}).fingerprint,insights(second,date,{now}).fingerprint);assert.equal(summarize(second,date,{now}).meals.length,1);
});
test('moving a plan changes fueling context and evidence fingerprint',()=>{
 const first=[confirmed,entry('plan','p1',plan,'2026-04-05')],second=[confirmed,entry('plan','p1',{...plan,start:'2026-04-09T12:00:00Z'},'2026-04-09',2)];assert.equal(summarize(first,date,{now}).band,'high');assert.equal(summarize(second,date,{now}).band,'light');assert.notEqual(insights(first,date,{now}).fingerprint,insights(second,date,{now}).fingerprint);
});
test('timed plans are limited to actual future 48 hours, not three calendar dates',()=>{
 const data=[entry('plan','inside',{...plan,start:'2026-04-06T15:59:59Z'},'2026-04-06'),entry('plan','outside',{...plan,start:'2026-04-06T16:00:00Z'},'2026-04-06'),entry('plan','past',{...plan,start:'2026-04-04T15:00:00Z'},date)];assert.deepEqual(summarize(data,date,{now}).plans.map(p=>p.id),['inside']);
});
test('DST boundaries have 23/25 hours and ambiguous floating times require an offset',()=>{
 const spring=dayBounds('2026-03-08','America/New_York'),fall=dayBounds('2026-11-01','America/New_York');assert.equal((Date.parse(spring.end)-Date.parse(spring.start))/3600000,23);assert.equal((Date.parse(fall.end)-Date.parse(fall.start))/3600000,25);assert.throws(()=>zonedInstant('2026-03-08T02:30:00','America/New_York'),/ambiguous or does not exist/);assert.throws(()=>zonedInstant('2026-11-01T01:30:00','America/New_York'),/ambiguous or does not exist/);assert.notEqual(zonedInstant('2026-11-01T01:30:00-04:00','America/New_York'),zonedInstant('2026-11-01T01:30:00-05:00','America/New_York'));assert.equal(localDate('2026-11-01T05:30:00Z'),'2026-11-01');assert.equal(addDays('2026-03-08',1),'2026-03-09');
});
test('all-day calendar date remains its supplied date across DST',()=>{
 const result=importCalendar('BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:a\nDTSTART;VALUE=DATE:20261101\nDTEND;VALUE=DATE:20261102\nSUMMARY:Long run\nEND:VEVENT\nEND:VCALENDAR','America/New_York');assert.equal(result.candidates[0].date,'2026-11-01');assert.equal((result.candidates[0].data as Plan).start,null);
});
test('same workout across devices matches; a distinct later run does not',()=>{
 const existing=[entry('workout','w',{...workout,sport:'Run'}) as unknown as Entry<Workout>];assert.equal(matchWorkout({...workout,start:'2026-04-04T11:00:20Z'},existing).length,1);assert.equal(matchWorkout({...workout,start:'2026-04-04T12:00:00Z'},existing).length,0);
});
test('pending or unscorable WHOOP cycles are not zero expenditure',()=>{
 const s=summarize([entry('recovery','r',{start:'2026-04-04T04:00:00Z',end:null,scoreState:'PENDING_SCORE',kilojoules:null})],date,{now});assert.equal(s.expenditure[0].kcal,null);
});
test('imports without source message times are stable and keep unknown timestamps',()=>{
 const text=JSON.stringify([{id:'external-1',date,title:'Synthetic lunch',calories:500}]);const first=importMeals(text),repeat=importMeals(text);assert.deepEqual(first,repeat);assert.equal((first.candidates[0].data as Meal).messageTime,null);
});
test('idless title correction keeps its slot identity; duplicate identical meals have separate occurrences',()=>{
 const first=importMeals(JSON.stringify([{date,title:'Synthetic sandwich',mealType:'Lunch'}]));const changed=importMeals(JSON.stringify([{date,title:'Synthetic sandwich without topping',mealType:'Lunch'}]));assert.equal(first.candidates[0].key,changed.candidates[0].key);const two=importMeals(JSON.stringify([{date,title:'Gel',mealType:'Run fuel'},{date,title:'Gel',mealType:'Run fuel'}]));assert.notEqual(two.candidates[0].key,two.candidates[1].key);
});
test('reimport preserves corrected or deleted meals; identical data is a duplicate',()=>{
 const candidate=importMeals(JSON.stringify([{id:'one',date,title:'Synthetic lunch',calories:500}])).candidates[0];const existing={data:candidate.data as Meal,localDate:date};assert.equal(reconcileMealImport(existing,candidate).action,'duplicate');assert.equal(reconcileMealImport({...existing,data:{...existing.data,calories:350}},candidate).action,'preserve');assert.equal(reconcileMealImport({...existing,deleted:true},candidate).action,'preserve');
});
test('daily aggregate or assistant rows are never attributed as meals or ETL portions',()=>{
 const parsed=importMeals(JSON.stringify([{id:'m',date,title:'Synthetic meal',etl:{rawVegetablesG:50}},{date,title:'Daily total',calories:1500,etl:{starchCups:2}},{date,title:'Assistant recap',role:'assistant',calories:1500}]));assert.equal(parsed.candidates.length,1);assert.equal((parsed.candidates[0].data as Meal).etl?.starchCups,undefined);
});
test('selected ChatGPT export walks selected branch and excludes assistant totals and old edits',()=>{
 const parsed=importMeals(JSON.stringify({id:'conversation',title:'REMY -- ETL',current_node:'a',mapping:{root:{id:'root',parent:null,children:['old','u']},old:{id:'old',parent:'root',children:[],message:{author:{role:'user'},content:{parts:['2026-04-04\nLunch: Superseded meal']}}},u:{id:'u',parent:'root',children:['a'],message:{id:'user-msg',author:{role:'user'},create_time:1775304000,content:{parts:['2026-04-04\nLunch: Selected meal | 500 kcal']}}},a:{id:'a',parent:'u',children:[],message:{author:{role:'assistant'},content:{parts:['Dinner: Invented cumulative summary | 1500 kcal']}}}}}));assert.equal(parsed.candidates.length,1);assert.equal((parsed.candidates[0].data as Meal).title,'Selected meal');assert.match(parsed.candidates[0].key,/user-msg/);
});
test('transcript skips corrections and cumulative summaries, with explicit review warning',()=>{
 const parsed=importTranscript('2026-04-04\nUser: Lunch: Example | 500 kcal\nAssistant: daily total 500 kcal\nDinner: Assistant summary | 800 kcal\nUser: Actually there was no cheese');assert.equal(parsed.candidates.length,1);assert.match(parsed.warnings.join(' '),/corrections/);
});
test('commit discriminates candidate kinds and source compatibility',()=>{
 const candidate=importMeals(JSON.stringify([{id:'m',date,title:'Example'}])).candidates[0];assert.equal(importCommitSchema.safeParse({action:'commit',reviewed:true,source:'remy-etl',candidates:[candidate]}).success,true);assert.equal(importCommitSchema.safeParse({action:'commit',reviewed:true,source:'strava',candidates:[candidate]}).success,false);assert.equal(importCommitSchema.safeParse({action:'commit',reviewed:true,source:'remy-etl',candidates:[{...candidate,kind:'profile'}]}).success,false);
});
test('CSV quoted commas, newlines and BOM are parsed without changing rows',()=>{assert.deepEqual(parseCsv('\uFEFFActivity ID,Name\r\n1,"A, B"\r\n2,"C\nD"'),[['Activity ID','Name'],['1','A, B'],['2','C\nD']]);});
test('partial log insights avoid definitive underfuel claims and carry record revisions',()=>{
 const data=[confirmed,entry('meal','m',meal),entry('plan','p',plan,'2026-04-05'),entry('recovery','r',{start:'2026-04-04T04:00:00Z',end:null,scoreState:'SCORED',kilojoules:12000})],copy=JSON.stringify(data),report=insights(data,date,{now});assert.equal(report.coverage.foodComplete,false);assert.ok(report.actions.length<=3);assert.match(report.headline.body,/incomplete/);assert.doesNotMatch(report.headline.body,/you (underate|ate too little)|you are underfuel/i);assert.ok(report.headline.recordLinks.some(link=>link.id==='m'&&link.revision===1));assert.ok(report.actions.some(a=>a.references.some(r=>r.url.includes('dietitians.ca'))));assert.equal(JSON.stringify(data),copy);
});
test('ETL advice has no invented category quotas or moral judgment about run fuel',()=>{
 const report=insights([entry('meal','m',{...meal,etl:{runFuelCalories:100,flexCalories:100}})],date,{now});assert.match(report.observations.find(o=>o.id==='etl-recorded')!.body,/not been entered/);assert.equal(report.coverage.etlFieldsKnown,2);assert.ok(report.actions.some(a=>a.body.includes('No category limit or quota')));
});
test('before-run g/kg guidance is not applied to short or unknown-duration plans',()=>{
 assert.equal(fuelingPlan({...plan,durationSec:null},{...DEFAULT_PROFILE,confirmed:true,weightKg:70}).before,null);assert.equal(fuelingPlan({...plan,durationSec:1800},{...DEFAULT_PROFILE,confirmed:true,weightKg:70}).before,null);
});
test('official FIT decoding preserves units and compressed copies share identity',async()=>{
 const encoder=new Encoder();encoder.onMesg(Profile.MesgNum.FILE_ID,{manufacturer:'development',type:'activity',timeCreated:new Date('2026-04-04T11:00:00Z')} as FileIdMesg);
 encoder.onMesg(Profile.MesgNum.SESSION,{sport:'running',startTime:new Date('2026-04-04T11:00:00Z'),timestamp:new Date('2026-04-04T12:00:00Z'),totalTimerTime:3600,totalDistance:10000,totalCalories:600} as SessionMesg);
 const bytes=Buffer.from(encoder.close()),plain=await importFit(bytes.toString('base64'),'America/New_York'),compressed=await importFit(gzipSync(bytes).toString('base64'),'America/New_York');
 assert.equal(plain.candidates.length,1);assert.equal((plain.candidates[0].data as Workout).distanceMeters,10000);assert.equal((plain.candidates[0].data as Workout).durationSec,3600);assert.equal(plain.candidates[0].key,compressed.candidates[0].key);
 bytes[bytes.length-1]^=0xff;await assert.rejects(()=>importFit(bytes.toString('base64'),'America/New_York'),/integrity/);
});
test('compressed FIT import limits expanded size before decoding',async()=>{
 const compressed=gzipSync(Buffer.alloc(8_000_001));await assert.rejects(()=>importFit(compressed.toString('base64'),'America/New_York'),/8 MB/);
});

