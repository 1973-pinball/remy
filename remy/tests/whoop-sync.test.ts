import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as domain from '../lib/domain';
import type {Entry} from '../lib/domain';

const code=ts.transpileModule(readFileSync(new URL('../lib/connections.ts',import.meta.url),'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
const cycle={id:123,start:'2026-07-22T03:00:00Z',end:'2026-07-23T03:00:00Z',score_state:'SCORED',score:{kilojoule:8000,strain:12}};
const recovery={cycle_id:123,score_state:'SCORED',score:{recovery_score:70,hrv_rmssd_milli:60,resting_heart_rate:50}};
const sleep={cycle_id:123,nap:false,score_state:'SCORED',score:{stage_summary:{
 total_light_sleep_time_milli:14400000,total_slow_wave_sleep_time_milli:3600000,total_rem_sleep_time_milli:7200000,
}}};
const existing:Entry={id:'synthetic-cycle',kind:'recovery',localDate:'2026-07-21',source:'whoop',sourceId:'123',revision:4,updatedAt:'2026-10-20T11:00:00Z',data:{
 start:cycle.start,end:cycle.end,scoreState:'SCORED',kilojoules:7000,strain:10,recovery:70,hrv:60,restingHr:50,sleepHours:7,
 raw:{cycle:{...cycle,score:{kilojoule:7000,strain:10}},recovery,sleep},
}};
type Write={id?:string;expectedRevision?:number;guard?:unknown;kind:string;source?:string;sourceId?:string;localDate:string|null;data:Record<string,unknown>};
function harness(payloads:Record<string,unknown[]>,entries:Entry[]=[existing]){
 const batch:Write[]=[],status:Write[]=[],requests:string[]=[];
 const guard={generation:1,provider:'whoop',version:2,disabled:false};
 const store={
  operationGuard:async()=>guard,listEntries:async()=>structuredClone(entries),
  acquireRefreshLock:async()=> 'synthetic-lock',releaseRefreshLock:async()=>{},
  readSecret:async()=>({access_token:'synthetic-token',refresh_token:'unused',expiresAt:Date.now()+3600000}),
  saveEntries:async(_owner:string,inputs:Write[])=>{batch.push(...structuredClone(inputs));},
  saveEntry:async(_owner:string,input:Write)=>{status.push(structuredClone(input));},
 };
 const modules:Record<string,unknown>={'server-only':{},'./store':store,'./domain':domain,'./imports':{}};
 const module={exports:{}} as {exports:typeof import('../lib/connections')};
 const fetch=async(input:string)=>{
  const url=new URL(input);assert.equal(url.origin,'https://api.prod.whoop.com');
  const resource=url.pathname.replace('/developer/v2/','');requests.push(resource);
  assert.ok(resource in payloads,'Every mocked resource must be explicit');
  assert.ok(url.searchParams.has('start'));assert.ok(url.searchParams.has('end'));
  return Response.json({records:payloads[resource],next_token:null});
 };
 new Function('require','module','exports','fetch',code)((name:string)=>{
  assert.ok(name in modules,`Unexpected module ${name}`);return modules[name];
 },module,module.exports,fetch);
 return{...module.exports,batch,status,requests,guard};
}

test('WHOOP window omissions retain each existing snapshot while current cycle metrics refresh',async()=>{
 const deleted={...existing,id:'deleted-cycle',sourceId:'789',deleted:true};
 const h=harness({cycle:[cycle,{...cycle,id:456},{...cycle,id:789}],recovery:[],'activity/sleep':[]},[existing,deleted]);
 await h.syncSource('synthetic-owner','whoop');
 assert.deepEqual(h.requests,['cycle','recovery','activity/sleep']);
 assert.equal(h.batch.length,2,'Deleted cycles must not be resurrected');
 const saved=h.batch.find(row=>row.id===existing.id)!;
 assert.equal(saved.expectedRevision,4);assert.deepEqual(saved.guard,h.guard);
 assert.equal(saved.localDate,existing.localDate);assert.equal(saved.sourceId,'123');
 assert.deepEqual(saved.data,{...existing.data,kilojoules:8000,strain:12,raw:{cycle,recovery,sleep}});
 const newCycle=h.batch.find(row=>row.sourceId==='456')!;
 for(const field of ['recovery','hrv','restingHr','sleepHours'])assert.equal(newCycle.data[field],null,'New records have no prior measurements to retain');
 assert.deepEqual(h.status[0].data.missingFields,['recovery','sleep'],'Omitted responses remain visible in connection status');
});

test('WHOOP explicitly pending or null scores clear old values instead of restoring stale measurements',async()=>{
 for(const scoreState of ['PENDING_SCORE','UNSCORABLE','SCORED']){
  const incomingRecovery={...recovery,score_state:scoreState,score:null};
  const incomingSleep={...sleep,score_state:scoreState,score:null};
  const h=harness({cycle:[{...cycle,score_state:'PENDING_SCORE',score:null}],recovery:[incomingRecovery],'activity/sleep':[incomingSleep]});
  await h.syncSource('synthetic-owner','whoop');
  const saved=h.batch[0].data;
  for(const field of ['recovery','hrv','restingHr','sleepHours','kilojoules','strain'])assert.equal(saved[field],null);
  assert.deepEqual((saved.raw as Record<string,unknown>).recovery,incomingRecovery);
  assert.deepEqual((saved.raw as Record<string,unknown>).sleep,incomingSleep);
 }
 const h=harness({});
 const explicitlyAbsent=h.reconcileWhoopCycle(existing,cycle,null,null);
 assert.equal(explicitlyAbsent.recovery,null);assert.equal(explicitlyAbsent.sleepHours,null);
 assert.equal(explicitlyAbsent.raw.recovery,null);assert.equal(explicitlyAbsent.raw.sleep,null);
});

test('WHOOP independently refreshes provided resources and preserves only omitted same-cycle data',async()=>{
 const revised={...recovery,score:{recovery_score:0,hrv_rmssd_milli:null,resting_heart_rate:55}};
 const h=harness({cycle:[cycle],recovery:[revised],'activity/sleep':[]});
 await h.syncSource('synthetic-owner','whoop');
 const saved=h.batch[0].data;
 assert.equal(saved.recovery,0);assert.equal(saved.hrv,null);assert.equal(saved.restingHr,55);assert.equal(saved.sleepHours,7);
 assert.deepEqual((saved.raw as Record<string,unknown>).recovery,revised);
 assert.deepEqual((saved.raw as Record<string,unknown>).sleep,sleep);
 const otherCycle=h.reconcileWhoopCycle({...existing,sourceId:'different-cycle'},cycle,undefined,undefined);
 assert.equal(otherCycle.recovery,null);assert.equal(otherCycle.sleepHours,null);
 const otherSource=h.reconcileWhoopCycle({...existing,source:'manual'},cycle,undefined,undefined);
 assert.equal(otherSource.recovery,null);assert.equal(otherSource.sleepHours,null);
});
