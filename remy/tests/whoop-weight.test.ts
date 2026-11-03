import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as domain from '../lib/domain';
import * as weights from '../lib/weight-history';
import {daySchema} from '../lib/validation';
import type {Entry} from '../lib/domain';

const baseScope='offline read:cycles read:recovery read:sleep', weightScope=baseScope+' read:body_measurement';
const observed='2026-11-03T03:00:00.000Z', old=weights.observeWhoopWeight({weight_kilogram:76},'2026-10-01T15:00:00Z','America/New_York')!;
const entry=(id:string,kind:Entry['kind'],data:Record<string,unknown>,date:string|null=null):Entry=>({id,kind,data,localDate:date,source:'manual',sourceId:id,revision:1,updatedAt:observed});
const compiled=(path:string)=>ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const connectionCode=compiled('../lib/connections.ts'),routeCode=compiled('../app/api/whoop/route.ts');

type Token={access_token:string;refresh_token:string;expiresAt:number;scope?:string};
function harness(options:{scope?:string;bodyStatus?:number;cycleStatus?:number;tokenExpired?:boolean;refreshScope?:string;callbackScope?:string;connectionAtSyncLock?:Record<string,unknown>;journalReadError?:string}={}){
 const guard={generation:1,provider:'whoop',version:1,disabled:false}, requests:string[]=[], saved:Record<string,unknown>[]=[], secretWrites:Record<string,unknown>[]=[], batches:unknown[][]=[],lockEvents:string[]=[];
 let token:Token={access_token:'synthetic-access-only',refresh_token:'synthetic-refresh-only',expiresAt:options.tokenExpired?1:Date.now()+3600000,...options.scope!==undefined?{scope:options.scope}:{}};
 let entries=[entry('connection:whoop','connection',{provider:'whoop',lastSuccess:'2026-10-01T15:00:00Z',weightSnapshots:[old]})];
 const secrets=new Map<string,unknown>([['whoop',token]]);
 const store={
  operationGuard:async()=>guard,enableSource:async()=>{},listEntries:async()=>{lockEvents.push('read');if(options.journalReadError)throw new Error(options.journalReadError);return structuredClone(entries);},getEntry:async(_owner:string,id:string)=>structuredClone(entries.find(row=>row.id===id)??null),
  acquireRefreshLock:async(_owner:string,key:string)=>{
   lockEvents.push(`acquire:${key}`);
   // A previous sync commits immediately before this request obtains its lock.
   if(key==='whoop:sync'&&options.connectionAtSyncLock)entries=entries.map(row=>row.id==='connection:whoop'?{...row,revision:row.revision+1,data:{...row.data,...options.connectionAtSyncLock}}:row);
   return 'test-lock';
  },releaseRefreshLock:async(_owner:string,key:string)=>{lockEvents.push(`release:${key}`);},
  readSecret:async(_owner:string,key:string)=>secrets.get(key)??null,
  writeSecret:async(_owner:string,key:string,value:unknown)=>{secrets.set(key,value);secretWrites.push({key,value});if(key==='whoop')token=value as Token;},
  deleteSecret:async(_owner:string,key:string)=>{secrets.delete(key);},
  saveEntries:async(_owner:string,inputs:unknown[])=>{batches.push(structuredClone(inputs));},
  saveEntry:async(_owner:string,input:{id:string;kind:Entry['kind'];localDate:string|null;data:Record<string,unknown>;expectedRevision?:number})=>{
   const current=entries.find(row=>row.id===input.id);if(input.expectedRevision!==undefined)assert.equal(input.expectedRevision,current?.revision);
   saved.push(structuredClone(input));const next={...entry(input.id,input.kind,input.data,input.localDate),revision:(current?.revision??0)+1};entries=entries.filter(row=>row.id!==input.id).concat(next);return{entry:next};
  },
 };
 const fetch=async(input:string,init?:RequestInit)=>{
  const url=new URL(input);assert.equal(url.origin,'https://api.prod.whoop.com');requests.push(url.pathname);
  if(url.pathname==='/oauth/oauth2/token'){
   const body=init?.body as URLSearchParams;
   if(body.get('grant_type')==='refresh_token'){
    assert.equal(body.get('scope'),'offline');
    return Response.json({access_token:'synthetic-renewed-only',refresh_token:'synthetic-rotated-only',expires_in:3600,...options.refreshScope!==undefined?{scope:options.refreshScope}:{}});
   }
   return Response.json({access_token:'synthetic-callback-only',refresh_token:'synthetic-callback-refresh-only',expires_in:3600,...options.callbackScope!==undefined?{scope:options.callbackScope}:{}});
  }
  if(url.pathname==='/developer/v2/user/measurement/body'){
   assert.ok(weights.hasWhoopWeightScope(token.scope),'No body request without a granted scope');
   return options.bodyStatus?Response.json({error:'synthetic denied'},{status:options.bodyStatus}):Response.json({weight_kilogram:75,height_meter:1.8,max_heart_rate:200,measurement_date:'1999-01-01'});
  }
  assert.ok(['/developer/v2/cycle','/developer/v2/recovery','/developer/v2/activity/sleep'].includes(url.pathname));
  if(url.pathname==='/developer/v2/cycle'&&options.cycleStatus)return Response.json({error:'synthetic cycle failure'},{status:options.cycleStatus});
  return Response.json({records:[],next_token:null});
 };
 const modules:Record<string,unknown>={'server-only':{},'./store':store,'./domain':domain,'./imports':{},'./weight-history':weights};
 const module={exports:{}} as {exports:typeof import('../lib/connections')};
 const environment={env:{WHOOP_CLIENT_ID:'synthetic-app',WHOOP_CLIENT_SECRET:'synthetic-secret',SECRET_ENCRYPTION_KEY:'synthetic-encryption',APP_ORIGIN:'https://remy.example'}};
 new Function('require','module','exports','fetch','process',connectionCode)((name:string)=>{assert.ok(name in modules,name);return modules[name];},module,module.exports,fetch,environment);
 const routeModules:Record<string,unknown>={
  '@/lib/connections':module.exports,'@/lib/store':store,'@/lib/weight-history':weights,
  '@/lib/http':{authorize:async()=>({userId:'test-owner'}),failure:(error:Error)=>Response.json({error:error.message},{status:400})},
 };
 const route={exports:{}} as {exports:typeof import('../app/api/whoop/route')};
 new Function('require','module','exports','fetch',routeCode)((name:string)=>{assert.ok(name in routeModules,name);return routeModules[name];},route,route.exports,fetch);
 return{connections:module.exports,route:route.exports,requests,saved,secretWrites,secrets,batches,lockEvents,getToken:()=>token};
}

test('WHOOP current weight snapshots use observation date, retain history, and never invent a weigh-in timestamp',()=>{
 const value=weights.observeWhoopWeight({weight_kilogram:75,height_meter:1.8,max_heart_rate:180,measurement_date:'2000-01-01'},observed,'America/New_York')!;
 assert.deepEqual(value,{date:'2026-11-02',weightKg:75,observedAt:observed,sourceLabel:weights.WHOOP_WEIGHT_LABEL});
 const later={...value,weightKg:74.5,observedAt:'2026-11-03T04:00:00.000Z'};
 const merged=weights.mergeWhoopWeightSnapshots([old,value],later);assert.equal(merged.length,2);assert.deepEqual(merged[0],old);assert.deepEqual(merged[1],later);
 assert.deepEqual(weights.mergeWhoopWeightSnapshots(merged,later),merged);assert.deepEqual(weights.mergeWhoopWeightSnapshots(merged,value),merged);
 for(const weight of [null,0,-1,'75',NaN,Infinity])assert.equal(weights.observeWhoopWeight({weight_kilogram:weight},observed,'America/New_York'),null);
 assert.equal(weights.observeWhoopWeight({weight_kilogram:75},'not-a-time','America/New_York'),null);
});

test('weight history prefers dated weigh-ins, ignores undated profile weight, and leaves missing days absent',()=>{
 const snapshot=weights.observeWhoopWeight({weight_kilogram:75},observed,'America/New_York')!;
 const points=weights.weightHistory([
  entry('profile','profile',{weightKg:99}),entry('connection:whoop','connection',{weightSnapshots:[old,snapshot]}),
  entry('day','day',{weightKg:74},'2026-11-02'),entry('missing','day',{weightKg:null},'2026-11-01'),
  {...entry('deleted','day',{weightKg:88},'2026-11-01'),deleted:true},
 ]);
 assert.deepEqual(points.map(point=>point.date),['2026-10-01','2026-11-02']);assert.equal(points[0].measurementDateKnown,false);
 assert.equal(points[0].observedAt,old.observedAt);assert.equal(points[1].weightKg,74);assert.equal(points[1].observedAt,null);
 assert.equal(points[1].measurementDateKnown,true);assert.ok(Math.abs(points[1].weightLb-74/0.45359237)<0.000001);
});

test('weight provenance survives day validation and is independent of the day’s food source',()=>{
 const humeDay={...entry('day:2026-08-17','day',daySchema.parse({...domain.emptyDay,weightKg:75.1,weightSource:'hume'}),'2026-08-17'),source:'remy-etl'};
 const manualDay={...entry('day:2026-08-18','day',daySchema.parse({...domain.emptyDay,weightKg:75,weightSource:'manual'}),'2026-08-18'),source:'remy-etl'};
 const legacyDay={...entry('day:2026-08-25','day',{...domain.emptyDay,weightKg:75.3},'2026-08-25'),source:'remy-etl'};
 const points=weights.weightHistory([humeDay,manualDay,legacyDay]);
 assert.equal(points[0].source,'hume');assert.equal(points[0].sourceLabel,'Hume weigh-in · entered from your history');
 assert.equal(points[1].source,'manual');assert.equal(points[1].sourceLabel,'Recorded weigh-in');
 assert.equal(points[2].source,'remy-etl');assert.equal(points[2].sourceLabel,'Dated weight reported in REMY history');
 assert.equal(humeDay.source,'remy-etl');
 assert.equal(daySchema.safeParse({...domain.emptyDay,weightKg:75,weightSource:'unsupported'}).success,false);
});

test('weight permission gates the endpoint and safe connection status never exposes credentials',async()=>{
 for(const scope of [undefined,baseScope,'read:body_measurement_extra']){
  const h=harness({scope});await h.connections.syncSource('test-owner','whoop');
  assert.equal(h.requests.length,3);assert.equal(h.saved.length,1);assert.deepEqual((h.saved[0].data as Record<string,unknown>).weightSnapshots,[old]);
  const configuration=await h.connections.configuredSources('test-owner');assert.equal(configuration.permissions.whoop.weight,false);
  assert.doesNotMatch(JSON.stringify(configuration),/synthetic-access|synthetic-refresh|synthetic-secret/);
 }
});

test('granted body sync stores one current observation per date and optional failure leaves recovery sync successful',async()=>{
 const h=harness({scope:weightScope});await h.connections.syncSource('test-owner','whoop');await h.connections.syncSource('test-owner','whoop');
 const data=h.saved.at(-1)!.data as Record<string,unknown>,snapshots=data.weightSnapshots as weights.WhoopWeightSnapshot[];
 assert.equal(snapshots.length,2);assert.deepEqual(snapshots[0],old);assert.equal(snapshots[1].weightKg,75);
 assert.equal(snapshots[1].date,domain.localDate(snapshots[1].observedAt));assert.notEqual(snapshots[1].date,'1999-01-01');
 assert.equal(data.weightPermission,true);assert.equal(data.weightError,null);assert.equal(data.complete,true);
 const denied=harness({scope:weightScope,bodyStatus:403});await denied.connections.syncSource('test-owner','whoop');
 const status=denied.saved[0].data as Record<string,unknown>;assert.equal(status.complete,true);assert.equal(status.error,null);
 assert.match(String(status.weightError),/Access denied/);assert.deepEqual(status.weightSnapshots,[old]);assert.equal(denied.batches.length,1);
});

test('a preceding sync’s weight observations survive both optional and primary source failures',async()=>{
 const latest=weights.observeWhoopWeight({weight_kilogram:74.5},'2026-11-02T15:00:00Z','America/New_York')!;
 for(const failure of ['body','cycle'] as const){
  const h=harness({scope:weightScope,connectionAtSyncLock:{weightSnapshots:[old,latest],weightLastObservedAt:latest.observedAt},
   ...(failure==='body'?{bodyStatus:403}:{cycleStatus:404})});
  if(failure==='cycle')await assert.rejects(h.connections.syncSource('test-owner','whoop'),/Source request failed/);
  else await h.connections.syncSource('test-owner','whoop');
  const data=h.saved.at(-1)!.data as Record<string,unknown>;
  assert.deepEqual(data.weightSnapshots,[old,latest],'Status writes must preserve observations committed before lock acquisition');
  assert.equal(data.weightLastObservedAt,latest.observedAt);
  assert.equal(data.complete,failure==='body');
  assert.deepEqual(h.lockEvents,['acquire:whoop:sync','read','release:whoop:sync']);
 }
});

test('journal-read errors and newly disconnected state release the sync lock without overwriting status',async()=>{
 for(const options of [{journalReadError:'Synthetic journal read failure'},{connectionAtSyncLock:{disconnected:true}}]){
  const h=harness(options);
  await assert.rejects(h.connections.syncSource('test-owner','whoop'),/Synthetic journal read failure|disconnected/);
  assert.deepEqual(h.lockEvents,['acquire:whoop:sync','read','release:whoop:sync']);
  assert.equal(h.saved.length,0);assert.equal(h.requests.length,0);assert.equal(h.batches.length,0);
 }
});

test('documented offline refresh retains omitted scope while respecting explicit narrower scope',async()=>{
 const h=harness({scope:weightScope,tokenExpired:true});await h.connections.providerToken('test-owner','whoop');
 assert.equal(h.getToken().scope,weightScope);
 const narrow=harness({scope:weightScope,tokenExpired:true,refreshScope:baseScope});await narrow.connections.providerToken('test-owner','whoop');
 assert.equal(narrow.getToken().scope,baseScope);assert.equal(weights.hasWhoopWeightScope(narrow.getToken().scope),false);
});

test('OAuth expands weight access only on opt-in or an existing grant and preserves dated observations after callback',async()=>{
 for(const [scope,weight,expected] of [[baseScope,false,false],[baseScope,true,true],[weightScope,false,true]] as const){
  const h=harness({scope});const response=await h.route.GET(new Request('https://remy.example/api/whoop'+(weight?'?weight=1':'')));
  assert.equal(response.status,302);const destination=new URL(response.headers.get('location')!);assert.equal(destination.origin,'https://api.prod.whoop.com');
  assert.equal(weights.hasWhoopWeightScope(destination.searchParams.get('scope')),expected);assert.equal(h.requests.length,0);
 }
 for(const callbackScope of [undefined,baseScope]){
  const h=harness({scope:baseScope,callbackScope});const start=await h.route.GET(new Request('https://remy.example/api/whoop?weight=1'));
  const state=new URL(start.headers.get('location')!).searchParams.get('state');
  const response=await h.route.GET(new Request('https://remy.example/api/whoop?code=synthetic-code&state='+state));assert.equal(response.status,302);
  const data=h.saved[0].data as Record<string,unknown>;assert.deepEqual(data.weightSnapshots,[old]);assert.equal(data.lastSuccess,'2026-10-01T15:00:00Z');
  assert.equal(data.weightPermission,callbackScope===undefined);assert.equal(weights.hasWhoopWeightScope(h.getToken().scope),callbackScope===undefined);
 }
});
