import test from 'node:test';
import assert from 'node:assert/strict';
import { completedCycleHistory, exertionHistory } from '../lib/exertion-history';
import type { Entry } from '../lib/domain';
function run(id:string,date:string,distanceMeters:number|null,durationSec:number|null,sport='run'):Entry {
 return {id,kind:'workout',localDate:date,source:'strava',sourceId:id,revision:1,updatedAt:'2026-11-03T15:00:00Z',data:{sport,distanceMeters,durationSec}};
}
test('exertion range keeps partial run coverage and unknown dates without counting later, deleted, or nonrunning activities',()=>{
 const records=[run('known','2026-11-02',6450,2394),run('partial','2026-11-02',null,600),run('future','2026-11-03',10000,3600),run('cycle','2026-11-02',50000,3000,'ride'),{...run('deleted','2026-11-01',99999,5000),deleted:true}];
 const before=structuredClone(records),days=exertionHistory(records,'2026-11-02',7,'2026-11-03T15:00:00Z');
 assert.equal(days.length,7);assert.equal(days[0].date,'2026-10-27');assert.equal(days.at(-1)?.date,'2026-11-02');
 assert.equal(days[0].km,null);assert.equal(days[0].minutes,null);assert.equal(days[0].burn,null);
 assert.equal(days.at(-1)?.km,6.45);assert.equal(days.at(-1)?.minutes,49.9);
 assert.equal(days.at(-1)?.distanceKnown,1);assert.equal(days.at(-1)?.durationKnown,2);assert.equal(days.at(-1)?.runCount,2);
 assert.deepEqual(records,before);
});
test('completed cycle table preserves cross-midnight expenditure as a period and excludes ongoing or future completions',()=>{
 const make=(id:string,end:string|null):Entry=>({id,kind:'recovery',localDate:'2026-11-02',source:'whoop',sourceId:id,revision:1,updatedAt:'2026-11-04T15:00:00Z',data:{start:'2026-11-02T05:29:00Z',end,raw:{privateMarker:'MUST_NOT_LEAK',sleep:{end:'2026-11-02T12:17:00Z'}},scoreState:'SCORED',kilojoules:8368,strain:12,recovery:null,sleepHours:null}});
 const records=[make('crossing','2026-11-03T06:00:00Z'),make('later','2026-11-04T12:00:00Z'),make('open',null),{...make('deleted','2026-11-03T06:00:00Z'),deleted:true}];
 assert.equal(completedCycleHistory(records,'2026-11-02',7,'2026-11-04T15:00:00Z').length,0);
 const rows=completedCycleHistory(records,'2026-11-03',7,'2026-11-04T15:00:00Z');
 assert.deepEqual(rows.map(row=>row.id),['crossing']);assert.equal(rows[0].expenditureKcal,2000);assert.equal(rows[0].strain,12);
 assert.equal(rows[0].recovery,null);assert.equal(rows[0].recoveryDate,'2026-11-02');assert.doesNotMatch(JSON.stringify(rows),/MUST_NOT_LEAK|raw/);
});
test('exertion history attributes recovery by sleep completion and withholds later cycle totals',()=>{
 const cycle:Entry={id:'whoop',kind:'recovery',localDate:'2026-11-02',source:'whoop',sourceId:'cycle',revision:1,updatedAt:'2026-11-03T15:00:00Z',data:{start:'2026-11-03T03:19:00Z',end:'2026-11-04T04:00:00Z',raw:{sleep:{end:'2026-11-03T11:57:00Z'}},scoreState:'SCORED',kilojoules:8368,recovery:64,sleepHours:7.9,strain:12}};
 const past=exertionHistory([cycle],'2026-11-02',1,'2026-11-04T15:00:00Z')[0];
 assert.equal(past.recovery,null);assert.equal(past.burn,null);assert.equal(past.strain,null);
 const matched=exertionHistory([cycle],'2026-11-03',1,'2026-11-04T15:00:00Z')[0];
 assert.equal(matched.recovery,64);assert.equal(matched.burn,2000);assert.equal(matched.recoveryDateBasis,'sleep-completion');
});
