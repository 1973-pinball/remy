import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, type Entry } from '../lib/domain';
import { nextMealSuggestion } from '../lib/next-meal';
const date='2026-11-02', now='2026-11-03T15:00:00Z';
const entry=(id:string,kind:Entry['kind'],data:Record<string,unknown>,localDate=date):Entry=>({id,kind,data,localDate,source:'test',sourceId:id,revision:1,updatedAt:now});
const meal=(protein:number|null,id='meal')=>entry(id,'meal',{protein,carbs:80,calories:600,fat:20,fiber:12});
const run=entry('run','workout',{sport:'Run',title:'Easy run',start:'2026-11-02T15:00:00Z',durationSec:2400,distanceMeters:6450});
const suggest=(records:Entry[])=>nextMealSuggestion(summarize(records,date,{now}));
test('a completed run and protein below the usual range prioritize carbs and protein without asserting a deficit',()=>{
 const result=suggest([run,meal(72)]);
 assert.equal(result.title,'Carbs and protein for your next meal.');
 assert.match(result.body,/72 g protein recorded/);assert.match(result.body,/After the recorded run/);assert.match(result.note,/1 run recorded/);
 assert.match(result.note,/unlogged food remains unknown/);assert.doesNotMatch(result.body,/deficit|missing \d|need \d|remaining|calorie/i);
});
test('protein at or above the lower usual range never creates a catch-up or restrictive instruction',()=>{
 for(const protein of [120,135,160]){
  const result=suggest([run,meal(protein)]);
  assert.equal(result.title,'Keep carbs in your next normal meal.');assert.match(result.body,new RegExp(`${protein} g protein recorded`));
  assert.match(result.body,/hunger and comfortable portions/);assert.doesNotMatch(result.body,/shortfall|too much|avoid protein|stop eating|remaining/i);
 }
 assert.equal(suggest([meal(125)]).title,'Let appetite guide your next meal.');
});
test('unknown and partial protein are disclosed rather than converted to zero or a complete day',()=>{
 const missing=suggest([]);assert.match(missing.body,/total is still unknown/);assert.doesNotMatch(missing.body,/0 g/);
 const partial=suggest([meal(50),meal(null,'unknown')]);assert.match(partial.body,/50 g protein recorded across 1\/2 meals/);assert.match(partial.note,/unlogged food remains unknown/);
 const historical=suggest([entry('history','dailySummary',{protein:90})]);assert.match(historical.body,/historical estimate records 90 g protein; full-day coverage is unknown/i);
});
test('upcoming sessions add timing guidance and dietary restrictions replace specific protein suggestions',()=>{
 const plan=entry('plan','plan',{title:'Tempo run',start:'2026-11-03T12:00:00Z',durationSec:3600,cancelled:false,completedWorkoutId:null},'2026-11-03');
 const result=suggest([meal(70),plan,entry('profile','profile',{diet:'Soy allergy; avoid legumes'})]);
 assert.equal(result.title,'Carbs and protein for your next meal.');assert.match(result.body,/Near the planned session/);assert.match(result.note,/Next: Tempo run on 2026-11-03/);
 assert.match(result.body,/protein that fits your preferences/);assert.doesNotMatch(result.body,/beans or whole soy/);
 const completed=suggest([meal(70),{...plan,data:{...plan.data,completedWorkoutId:'done'}}]);assert.doesNotMatch(completed.note,/Next:/);
});
