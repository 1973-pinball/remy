import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

// Load the actual server-only module in its supported runtime condition. The
// pure reconciliation calls never create a Supabase client or contact a source.
test('workout reconciliation updates sources, merges missing metrics and retains local overrides',()=>{
 const moduleUrl=new URL('../lib/connections.ts',import.meta.url).href;
 const result=spawnSync(process.execPath,['--conditions=react-server','--import','tsx','--input-type=module','-e',`
  import assert from 'node:assert/strict';
  import {reconcileWorkout} from ${JSON.stringify(moduleUrl)};
  const incoming={title:'Synthetic run',start:'2026-04-04T11:00:00Z',durationSec:3600,distanceMeters:10000,avgHr:null,calories:600,elevationMeters:null,sport:'running',notes:''};
  const record=(data)=>({id:'synthetic',kind:'workout',localDate:'2026-04-04',source:'fit',sourceId:'fit-1',revision:1,updatedAt:'2026-04-04T12:00:00Z',data});
  const first=reconcileWorkout(null,'fit','fit-1',incoming,{id:'fit-1',revision:1});
  const revised=reconcileWorkout(record(first),'fit','fit-1',{...incoming,distanceMeters:11000},{id:'fit-1',revision:2});
  assert.equal(revised.distanceMeters,11000);
  assert.equal(revised.fieldSources.distanceMeters,'fit:fit-1');
  assert.equal(Object.keys(revised.sourceRecords).length,1);
  const strava={...incoming,distanceMeters:12000,calories:null};
  const merged=reconcileWorkout(record(revised),'strava','strava-1',strava,{id:'strava-1'});
  assert.equal(merged.distanceMeters,12000);
  assert.equal(merged.calories,600);
  assert.equal(merged.fieldSources.calories,'fit:fit-1');
  assert.equal(Object.keys(merged.sourceRecords).length,2);
  const corrected={...merged,distanceMeters:12345,title:'My corrected name'};
  const refreshed=reconcileWorkout(record(corrected),'strava','strava-1',{...strava,distanceMeters:12500},{id:'strava-1',revision:2});
  assert.equal(refreshed.distanceMeters,12345);
  assert.equal(refreshed.title,'My corrected name');
  assert.equal(refreshed.canonicalSourceData.distanceMeters,12500);
  assert.equal(refreshed.fieldSources.distanceMeters,'local');
  const repeated=reconcileWorkout(record(refreshed),'strava','strava-1',{...strava,distanceMeters:12500},{id:'strava-1',revision:2});
  assert.deepEqual(repeated,refreshed);
 `],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr||result.stdout);
});
