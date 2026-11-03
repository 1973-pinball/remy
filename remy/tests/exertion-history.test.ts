import test from 'node:test';
import assert from 'node:assert/strict';
import { completedCycleHistory, exertionHistory } from '../lib/exertion-history';
import {addDays,type Entry} from '../lib/domain';
function run(id:string,date:string,distanceMeters:number|null,durationSec:number|null,sport='run'):Entry {
 return {id,kind:'workout',localDate:date,source:'strava',sourceId:id,revision:1,updatedAt:'2026-11-03T15:00:00Z',data:{sport,distanceMeters,durationSec}};
}
test('exertion range keeps partial run coverage and unknown dates without counting later, deleted, or nonrunning activities',()=>{
 const records=[run('known','2026-11-02',6450,2394),run('partial','2026-11-02',null,600),run('future','2026-11-03',10000,3600),run('cycle','2026-11-02',50000,3000,'ride'),{...run('deleted','2026-11-01',99999,5000),deleted:true}];
 const before=structuredClone(records),days=exertionHistory(records,'2026-11-02',7,'2026-11-03T15:00:00Z');
 assert.equal(days.length,7);assert.equal(days[0].date,'2026-10-27');assert.equal(days.at(-1)?.date,'2026-11-02');
 assert.equal(days[0].miles,null);assert.equal(days[0].minutes,null);assert.equal(days[0].burn,null);
 assert.equal(days.at(-1)?.miles,4.01);assert.equal(days.at(-1)?.minutes,49.9);
 assert.equal(days.at(-1)?.distanceKnown,1);assert.equal(days.at(-1)?.durationKnown,2);assert.equal(days.at(-1)?.runCount,2);
 assert.deepEqual(records,before);
});

test('rolling mileage sums seven calendar dates, multiple runs and rest dates without duplicate source snapshots',()=>{
 const linked=run('linked','2026-10-27',1609.344,600);
 linked.data.sourceRecords={'strava:linked':{data:{distanceMeters:1609.344}},'tredict:linked':{data:{distanceMeters:1609.344}}};
 const records=[linked,run('second','2026-10-27',3218.688,1200),run('third','2026-10-29',4828.032,1800),run('last','2026-11-02',6437.376,2400),run('future','2026-11-03',16093.44,6000),run('ride','2026-11-01',160934.4,6000,'ride'),{...run('deleted','2026-11-01',16093.44,6000),deleted:true}];
 const before=structuredClone(records),days=exertionHistory(records,'2026-11-02',7,'2026-11-03T15:00:00Z');
 assert.deepEqual(days.slice(0,6).map(day=>day.rollingMiles7Day),Array(6).fill(null));
 assert.equal(days[6].rollingMiles7Day,10);assert.equal(days[6].rollingRunCount,4);assert.equal(days[6].rollingDistanceKnown,4);
 assert.equal(days[1].miles,null);assert.equal(days[6].miles,4);
 // Left edge of a narrowed chart still uses the six preceding dates.
 assert.equal(exertionHistory(records,'2026-11-02',1,'2026-11-03T15:00:00Z')[0].rollingMiles7Day,10);
 assert.deepEqual(records,before);
});

test('rolling mileage waits for day seven of saved history and has zero on a subsequent empty week',()=>{
 const records=[run('first','2026-10-27',1609.344,600)];
 const days=exertionHistory(records,'2026-11-09',14,'2026-11-10T15:00:00Z');
 assert.deepEqual(days.slice(0,6).map(day=>day.rollingMiles7Day),Array(6).fill(null));
 assert.equal(days[6].rollingMiles7Day,1);
 assert.equal(days[7].rollingMiles7Day,0);assert.equal(days[7].rollingRunCount,0);assert.equal(days[7].rollingDistanceKnown,0);
 assert.equal(days[13].rollingMiles7Day,0);assert.equal(days[13].miles,null);
 for(const unavailable of [[],[run('later','2026-11-03',1609.344,600)],[run('invalid','2026-02-30',1609.344,600)],[run('ride','2026-10-01',1609.344,600,'ride')]]){
  assert.ok(exertionHistory(unavailable,'2026-11-02',7,'2026-11-03T15:00:00Z').every(day=>day.rollingMiles7Day===null));
 }
});

test('missing or invalid distance suppresses every containing rolling window until it leaves',()=>{
 for(const unknown of [null,NaN,Infinity,-1]){
  const records=[run('history','2026-10-20',1609.344,600),run('missing','2026-10-30',unknown,600),run('known','2026-11-01',3218.688,1200)];
  const days=exertionHistory(records,'2026-11-06',8,'2026-11-07T15:00:00Z');
  assert.deepEqual(days.slice(0,7).map(day=>day.rollingMiles7Day),Array(7).fill(null));
  assert.equal(days[2].rollingRunCount,2);assert.equal(days[2].rollingDistanceKnown,1);
  assert.equal(days[7].rollingMiles7Day,2);assert.equal(days[7].rollingRunCount,1);assert.equal(days[7].rollingDistanceKnown,1);
 }
});

test('rolling mileage keeps meter precision and uses seven dates across daylight saving',()=>{
 const records=Array.from({length:7},(_,index)=>run(`run-${index}`,addDays('2026-10-27',index),10,60));
 const days=exertionHistory(records,'2026-11-02',7,'2026-11-03T15:00:00Z');
 assert.equal(days[6].date,'2026-11-02');assert.equal(days[6].rollingMiles7Day,0.04);
 assert.equal(days[6].rollingRunCount,7);assert.equal(days[6].rollingDistanceKnown,7);
 assert.ok(days.every(day=>day.miles===0.01));
 // Summing rounded daily miles would incorrectly produce 0.07.
 assert.notEqual(days[6].rollingMiles7Day,days.reduce((sum,day)=>sum+day.miles!,0));
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
