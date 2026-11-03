import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as domain from '../lib/domain';

const now = '2026-11-03T19:00:00.000Z', owner = 'test-owner';
const compile = (path: string) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: {target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.CommonJS},
}).outputText;
const serviceCode = compile('../lib/running-ytd.ts'), routeCode = compile('../app/api/running/ytd/route.ts'), httpCode = compile('../lib/http.ts');
function load<T>(code: string, modules: Record<string,unknown>, Clock: unknown = Date): T {
  const module = {exports:{}};
  new Function('require','module','exports','Date',code)((name:string) => {
    assert.ok(name in modules, `Unexpected dependency ${name}`); return modules[name];
  }, module, module.exports, Clock);
  return module.exports as T;
}

const activity = (id: number, start='2026-11-01T15:00:00Z', extra: Record<string,unknown>={}) => ({
  id, start_date:start, sport_type:'Run', name:'Test run', distance:1609.344, moving_time:600,
  average_heartrate:140, total_elevation_gain:20, ...extra,
});
type Options = {
  scope?:string|null; refreshedScope?:string; denied?:boolean; disabled?:boolean; disconnectAtReturn?:boolean;
  pages?:unknown[]; pagesForever?:boolean; advanceClockAfterFetch?:boolean; timezone?:string;
};
function harness(options:Options={}) {
  const requests:URL[] = [], events:string[] = [];
  let guardReads=0, secretReads=0, clock=Date.parse(now);
  class Clock extends Date { static now() { return clock; } }
  const guard={generation:1,provider:'strava',version:2,disabled:options.disabled??false};
  const store = {
    async operationGuard(requestedOwner:string, provider:string) {
      assert.equal(requestedOwner,owner);assert.equal(provider,'strava');events.push('guard');guardReads++;
      return {...guard, ...(options.disconnectAtReturn&&guardReads>1?{disabled:true,version:3}:{})};
    },
    async listEntries(requestedOwner:string) {
      assert.equal(requestedOwner,owner);events.push('entries');
      return [{id:'profile',kind:'profile',data:{...domain.DEFAULT_PROFILE,timezone:options.timezone??'America/New_York'},deleted:false}];
    },
    async readSecret(requestedOwner:string, provider:string) {
      assert.equal(requestedOwner,owner);assert.equal(provider,'strava');events.push('secret');secretReads++;
      return {access_token:'synthetic-secret-access',refresh_token:'synthetic-secret-refresh',
        scope:secretReads>1&&options.refreshedScope!==undefined?options.refreshedScope:options.scope===null?undefined:options.scope??'read,activity:read_all'};
    },
  };
  const connections = {
    async providerToken(requestedOwner:string, provider:string, captured:unknown) {
      assert.equal(requestedOwner,owner);assert.equal(provider,'strava');assert.deepEqual(captured,guard);events.push('token');return 'synthetic-secret-access';
    },
    async fetchSource(input:string, token:string, deadline:number) {
      assert.equal(token,'synthetic-secret-access');assert.ok(deadline>Date.parse(now));events.push('fetch');
      const url=new URL(input);assert.equal(url.origin,'https://www.strava.com');assert.equal(url.pathname,'/api/v3/athlete/activities');
      requests.push(url);const page=Number(url.searchParams.get('page'));
      if(options.advanceClockAfterFetch)clock+=41000;
      return Response.json(options.pagesForever?[activity(page)]:options.pages?.[page-1]??[]);
    },
  };
  const service=load<typeof import('../lib/running-ytd')>(serviceCode,{'server-only':{},'./connections':connections,'./store':store,'./domain':domain},Clock);
  const http=load<typeof import('../lib/http')>(httpCode,{'@/lib/supabase/server':{},'@/lib/supabase/config':{}});
  const route=load<typeof import('../app/api/running/ytd/route')>(routeCode,{
    '@/lib/http':{...http,async authorize() {events.push('authorize');if(options.denied)throw Object.assign(new Error('Sign in to use your private journal.'),{status:401});return{userId:owner};}},
    '@/lib/running-ytd':{runningYearToDate:(requestedOwner:string)=>service.runningYearToDate(requestedOwner,now)},
  });
  return {requests,events,run:()=>service.runningYearToDate(owner,now),get:()=>route.GET(new Request('https://remy.example/api/running/ytd'))};
}

test('authenticated YTD route continues through short pages, deduplicates activities, filters running sports, and excludes raw private fields',async()=>{
  const first=activity(1,'2026-01-01T05:00:00Z',{athlete:{id:987},map:{summary_polyline:'private-route'},start_latlng:[40,-73],device_name:'private-device',description:'private-note'});
  const app=harness({pages:[[first,activity(2,undefined,{sport_type:'Ride'})],[first,activity(3,undefined,{sport_type:'TrailRun'}),activity(4,undefined,{sport_type:'VirtualRun'})],[]]});
  const response=await app.get(), result=await response.json();
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.equal(app.events[0],'authorize');assert.equal(app.requests.length,3);assert.equal(result.complete,true);
  assert.equal(result.runCount,3);assert.equal(result.totalMiles,3);assert.equal(result.calendarDays,307);assert.equal(result.weeks,307/7);
  assert.equal(result.milesPerWeek,3/(307/7));assert.equal(result.from,'2026-01-01');assert.equal(result.through,'2026-11-03');
  assert.deepEqual(result.runs.map((run:{sourceId:string})=>run.sourceId),['1','3','4']);
  assert.deepEqual(Object.keys(result.runs[0]).sort(),['avgHr','date','distanceMeters','durationSec','elevationMeters','sourceId','sport','start','title'].sort());
  assert.doesNotMatch(JSON.stringify(result),/private-route|private-device|private-note|summary_polyline|start_latlng|synthetic-secret|refresh_token|access_token/);
  for(const url of app.requests){assert.equal(url.searchParams.get('per_page'),'50');assert.equal(url.searchParams.get('after'),String(Date.parse('2026-01-01T05:00:00Z')/1000-1));assert.equal(url.searchParams.get('before'),String(Date.parse(now)/1000+1));}
});

test('unauthenticated, disconnected, and unverified or narrowed activity scopes cannot fetch private history',async()=>{
  const denied=harness({denied:true});assert.equal((await denied.get()).status,401);assert.deepEqual(denied.events,['authorize']);
  for(const options of [{disabled:true},{scope:'activity:read'},{scope:null},{refreshedScope:'activity:read'}]){
    const app=harness(options);await assert.rejects(app.run(),/Connect Strava|Reconnect|permission/);assert.equal(app.requests.length,0);
  }
});

test('year boundaries use the profile timezone and exclude activities outside exact January 1-to-now bounds',async()=>{
  const app=harness({timezone:'America/Los_Angeles',pages:[[
    activity(1,'2026-01-01T07:59:59Z'),activity(2,'2026-01-01T08:00:00Z'),activity(3,now),activity(4,'2026-11-03T19:00:01Z'),
  ],[]]});
  const result=await app.run();assert.deepEqual(result.runs.map(run=>run.sourceId),['2','3']);
  assert.equal(result.runs[0].date,'2026-01-01');assert.equal(result.totalMiles,2);assert.equal(result.timezone,'America/Los_Angeles');
  assert.equal(app.requests[0].searchParams.get('after'),String(Date.parse('2026-01-01T08:00:00Z')/1000-1));
});

test('missing or invalid distances keep the full mileage and rate unknown while explicit zero remains valid',async()=>{
  const app=harness({pages:[[activity(1,undefined,{distance:0}),activity(2,undefined,{distance:'1609.344'}),activity(3,undefined,{distance:-1,average_heartrate:300}),activity(4)],[]]});
  const result=await app.run();assert.equal(result.complete,true);assert.equal(result.runCount,4);assert.equal(result.knownMiles,1);
  assert.equal(result.missingDistanceRuns,2);assert.equal(result.totalMiles,null);assert.equal(result.milesPerWeek,null);assert.equal(result.runs.find(run=>run.sourceId==='3')!.avgHr,null);
  const zero=await harness({pages:[[activity(1,undefined,{distance:0})],[]]}).run();assert.equal(zero.totalMiles,0);assert.equal(zero.milesPerWeek,0);
  const empty=await harness().run();assert.equal(empty.complete,true);assert.equal(empty.runCount,0);assert.equal(empty.totalMiles,0);
});

test('page and time limits or malformed run identities cannot masquerade as complete YTD totals',async()=>{
  const capped=harness({pagesForever:true}), capResult=await capped.run();assert.equal(capped.requests.length,20);assert.equal(capResult.complete,false);assert.equal(capResult.totalMiles,null);assert.equal(capResult.milesPerWeek,null);
  const timed=harness({pagesForever:true,advanceClockAfterFetch:true}), timedResult=await timed.run();assert.equal(timed.requests.length,1);assert.equal(timedResult.complete,false);assert.equal(timedResult.totalMiles,null);
  const malformed=await harness({pages:[[activity(1,undefined,{id:'invalid'}),activity(2,'not-a-date')],[]]}).run();
  assert.equal(malformed.complete,false);assert.equal(malformed.invalidRunRecords,2);assert.equal(malformed.totalMiles,null);
});

test('source errors reveal no provider body and a concurrent disconnect prevents returning captured history',async()=>{
  const app=harness({pages:[{error:'private-upstream-body',access_token:'synthetic-secret-access'}]});
  const response=await app.get();assert.equal(response.status,400);assert.match((await response.json()).error,/unsupported running-history data/);
  const disconnected=harness({pages:[[activity(1)],[]],disconnectAtReturn:true});
  const refused=await disconnected.get();assert.equal(refused.status,409);assert.doesNotMatch(await refused.text(),/Test run|1609|synthetic-secret/);
});
