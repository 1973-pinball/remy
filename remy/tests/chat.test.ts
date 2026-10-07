import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as zod from 'zod';
import * as domain from '../lib/domain';
import * as validation from '../lib/validation';
import * as insightModule from '../lib/insights';
import type {Entry,Kind,Meal} from '../lib/domain';

const code=ts.transpileModule(fs.readFileSync(new URL('../app/api/chat/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const date='2026-04-04';
const id1='10000000-0000-4000-8000-000000000001',id2='10000000-0000-4000-8000-000000000002',id3='10000000-0000-4000-8000-000000000003';
const syntheticMeal:Meal={title:'Existing synthetic meal',mealType:'Lunch',mealTime:null,messageTime:null,notes:'Synthetic fixture',confidence:'label',workoutId:null,calories:500,carbs:50,protein:20,fat:10,fiber:5};
function record(kind:Kind,id:string,data:object,day:string|null=date):Entry{return{id,kind,localDate:day,source:'test',sourceId:id,revision:1,updatedAt:'2026-04-04T12:00:00Z',data:data as Record<string,unknown>}}
type Input={guard?:{generation:number};id?:string;kind:Kind;localDate:string|null;source?:string;sourceId?:string;data:unknown;expectedRevision?:number;deleted?:boolean};
function harness(initial:Entry[]=[],onList?:(count:number,records:Map<string,Entry>)=>void){
 const records=new Map(initial.map(entry=>[entry.id,structuredClone(entry)]));let clock=0,lists=0,generation=1,failId:string|null=null;
 const store={
  operationGuard:async()=>({generation}),
  listEntries:async()=>{onList?.(++lists,records);return [...records.values()].filter(entry=>!entry.deleted).map(entry=>structuredClone(entry));},
  getEntry:async(_owner:string,id:string)=>structuredClone(records.get(id)??null),
  saveEntry:async(_owner:string,input:Input)=>{
   if(input.guard?.generation!==generation)throw new Error('Journal generation changed');
   const id=input.id??crypto.randomUUID();if(failId===id){failId=null;throw new Error('Simulated interrupted response write');}
   const old=records.get(id);if(old&&input.expectedRevision!=null&&old.revision!==input.expectedRevision)throw new Error('Revision conflict');
   const duplicate=!!old&&old.localDate===input.localDate&&JSON.stringify(old.data)===JSON.stringify(input.data)&&!!old.deleted===!!input.deleted;
   if(duplicate)return{entry:structuredClone(old!),duplicate:true};
   const entry:Entry={id,kind:input.kind,localDate:input.localDate,source:old?.source??input.source??'manual',sourceId:old?.sourceId??input.sourceId??id,revision:(old?.revision??0)+1,updatedAt:new Date(Date.parse('2026-04-04T16:00:00Z')+ ++clock).toISOString(),data:structuredClone(input.data) as Record<string,unknown>,deleted:!!input.deleted};records.set(id,entry);return{entry:structuredClone(entry),duplicate:false};
  }
 };
 const http={authorize:async()=>({userId:'synthetic-owner'}),body:(request:Request)=>request.json(),json:(value:unknown)=>Response.json(value),failure:(error:Error)=>Response.json({error:error.message},{status:400})};
 const modules:Record<string,unknown>={'zod':zod,'@/lib/http':http,'@/lib/store':store,'@/lib/domain':domain,'@/lib/validation':validation,'@/lib/insights':insightModule};
 const module:{exports:Record<string,unknown>}={exports:{}};
 new Function('require','module','exports',code)((name:string)=>{if(!(name in modules))throw new Error('Unexpected route dependency '+name);return modules[name]},module,module.exports);
 const post=module.exports.POST as (request:Request)=>Promise<Response>;
 return{records,invalidate:()=>{generation++;records.clear()},failReply:(id:string)=>{failId=`reply:${id}`},send:async(message:string,id=id1)=>{const response=await post(new Request('http://localhost/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,date,id})}));return{status:response.status,payload:await response.json()};}};
}

test('chat accepts Dinner-colon and keeps decimal nutrient values',async()=>{
 const h=harness(),result=await h.send('Dinner: soup | 500.5 kcal, 65.25 g carbs, 12.5 g protein, 8.5 g fat, 2.75 g fiber');assert.equal(result.status,200);const meal=h.records.get(`meal:${id1}`)!.data;assert.equal(meal.title,'soup');assert.equal(meal.calories,500.5);assert.equal(meal.carbs,65.25);assert.equal(meal.protein,12.5);assert.equal(meal.fat,8.5);assert.equal(meal.fiber,2.75);
});
test('chat validates explicit nutrients before any meal or message write',async()=>{
 for(const message of ['Lunch was soup | -50 kcal','Lunch was soup | 20000 kcal','Lunch was soup | -5 g protein']){const h=harness(),result=await h.send(message);assert.equal(result.status,400);assert.equal(h.records.size,0);}
 const h=harness();assert.equal((await h.send('Dinner was soup | 400 kcal plus 200 kcal')).status,400);
});
test('chat preserves unknowns and supports labelled decimal grams',async()=>{
 const h=harness();assert.equal((await h.send('Dinner was soup | protein: 12.5 g')).status,200);const meal=h.records.get(`meal:${id1}`)!.data;assert.equal(meal.protein,12.5);assert.equal(meal.calories,null);assert.equal(meal.carbs,null);
});
test('chat response and evidence use the same post-action snapshot',async()=>{
 const h=harness([record('meal','m',syntheticMeal)],(count,records)=>{if(count===2){const old=records.get('m')!;records.set('m',{...old,revision:2,data:{...old.data,calories:1250}})}});
 const result=await h.send('What should I eat tonight?');assert.equal(result.status,200);assert.match(result.payload.message.data.text,/1,250 kcal logged/);assert.match(result.payload.message.data.fingerprint,/m:2/);assert.equal(result.payload.message.data.inputs.find((entry:{id:string})=>entry.id==='m').revision,2);assert.equal(result.payload.message.data.fingerprint,domain.summarize([...h.records.values()],date).fingerprint);
});
test('chat shares WHOOP, weekly mileage and preference-aware ETL insight context',async()=>{
 const h=harness([record('profile','profile',{...domain.DEFAULT_PROFILE,diet:'soy-free'},null),record('meal','m',syntheticMeal),record('workout','run',{title:'Synthetic run',start:'2026-04-03T12:00:00Z',durationSec:3600,distanceMeters:16093.44,avgHr:null,calories:600,elevationMeters:null,sport:'running',notes:''},'2026-04-03'),record('recovery','cycle',{start:'2026-04-04T04:00:00Z',end:'2026-04-05T04:00:00Z',scoreState:'SCORED',kilojoules:8368})]);
 const result=await h.send('How do my ETL meals fit running?'),text=result.payload.message.data.text;assert.match(text,/WHOOP estimates 2,000 kcal/);assert.match(text,/10 miles recorded this week/);assert.match(text,/familiar protein source that fits your dietary preferences/);assert.doesNotMatch(text,/you underate|2,600 kcal/);assert.ok(result.payload.message.data.contextFingerprint);assert.ok(result.payload.message.data.references.some((ref:{url:string})=>ref.url.includes('dietitians.ca')));
});
test('yesterday command only moves unchanged meal from last conversational log',async()=>{
 const unrelated=record('meal','unrelated',{...syntheticMeal,title:'Recently edited different meal'}),h=harness([unrelated]);await h.send('Dinner: synthetic stew | 450 kcal',id1);
 h.records.set('unrelated',{...unrelated,revision:2,updatedAt:'2026-04-05T00:00:00Z'});
 const result=await h.send('That was yesterday’s dinner',id2);assert.equal(result.status,200);assert.equal(h.records.get(`meal:${id1}`)!.localDate,'2026-04-03');assert.equal(h.records.get('unrelated')!.localDate,date);assert.equal(result.payload.message.data.actionKind,'move-meal');
});
test('ambiguous yesterday commands select no arbitrary recently edited meal',async()=>{
 const h=harness([record('meal','m',syntheticMeal)]);const first=await h.send("That was yesterday's dinner",id1);assert.equal(h.records.get('m')!.localDate,date);assert.match(first.payload.message.data.text,/Choose the original meal in Food/);
 const another=harness();await another.send('Dinner: stew',id1);const meal=another.records.get(`meal:${id1}`)!;another.records.set(meal.id,{...meal,revision:meal.revision+1,data:{...meal.data,title:'Corrected elsewhere'}});await another.send("That was yesterday's dinner",id2);assert.equal(another.records.get(meal.id)!.localDate,date);
});
test('general discussion after a meal log makes deictic move ambiguous',async()=>{
 const h=harness();await h.send('Dinner: stew',id1);await h.send('How is my day?',id2);const result=await h.send("That was yesterday's dinner",id3);assert.match(result.payload.message.data.text,/Choose the original meal/);assert.equal(h.records.get(`meal:${id1}`)!.localDate,date);
});
test('replayed chat commands are idempotent, including interrupted replies and later meal corrections',async()=>{
 const h=harness();h.failReply(id1);assert.equal((await h.send('Dinner: stew | 500 kcal',id1)).status,400);const saved=h.records.get(`meal:${id1}`)!;h.records.set(saved.id,{...saved,revision:2,data:{...saved.data,calories:350}});const retried=await h.send('Dinner: stew | 500 kcal',id1);assert.equal(retried.status,200);assert.equal(h.records.get(saved.id)!.data.calories,350);assert.equal(h.records.get(saved.id)!.revision,2);const count=h.records.size;await h.send('Dinner: stew | 500 kcal',id1);assert.equal(h.records.size,count);assert.equal((await h.send('Dinner: a different meal',id1)).status,400);
});
test('retry after interrupted yesterday move does not move the meal twice',async()=>{
 const h=harness();await h.send('Dinner: stew',id1);h.failReply(id2);assert.equal((await h.send("That was yesterday's dinner",id2)).status,400);const result=await h.send("That was yesterday's dinner",id2);assert.equal(result.status,200);assert.equal(h.records.get(`meal:${id1}`)!.localDate,'2026-04-03');assert.equal(h.records.get(`meal:${id1}`)!.revision,2);
});
test('in-flight chat cannot recreate rows after the journal generation changes',async()=>{
 let h:ReturnType<typeof harness>;h=harness([record('meal','m',syntheticMeal)],count=>{if(count===1)h.invalidate()});const result=await h.send('Dinner: stew | 500 kcal');assert.equal(result.status,400);assert.match(result.payload.error,/generation changed/);assert.equal(h.records.size,0);
});
