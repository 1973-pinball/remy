import test from 'node:test';
import assert from 'node:assert/strict';
import {summarize,type Entry,type HistoricalDailySummary,type Meal} from '../lib/domain';
import {importMeals} from '../lib/imports';
import {importCommitSchema} from '../lib/validation';
import {coachProgress,coachContextFingerprint} from '../lib/coach-context';
import {buildCoachContext} from '../lib/coach-model';

const date='2026-04-04',now='2026-04-05T12:00:00Z';
const snapshot:HistoricalDailySummary={calories:2400,protein:120,carbs:310,fat:80,fiber:null,etl:{flexCalories:300,runFuelCalories:200},notes:'Synthetic historical estimate',sourceMessageId:'synthetic-source',confidence:'estimate',coverage:'unknown'};
const record=(kind:Entry['kind'],id:string,data:object):Entry=>({id,kind,source:'remy-etl',sourceId:id,localDate:date,updatedAt:now,revision:1,data:data as Record<string,unknown>});
const historical=record('dailySummary','history',snapshot);
const meal:Meal={title:'Synthetic meal',mealType:'Lunch',mealTime:null,messageTime:null,notes:'',confidence:'estimate',workoutId:null,calories:500,protein:30,carbs:null,fat:20,fiber:8,etl:{flexCalories:0}};
test('explicit historical rows import separately, require provenance, and cannot claim complete coverage',()=>{
 const result=importMeals(JSON.stringify({dailySummaries:[{id:'history',date,...snapshot}]}));
 assert.equal(result.candidates.length,1);assert.equal(result.candidates[0].kind,'dailySummary');
 assert.equal(result.warnings.length,0);
 assert.ok(importCommitSchema.safeParse({action:'commit',reviewed:true,source:'remy-etl',candidates:result.candidates}).success);
 assert.equal(importCommitSchema.safeParse({action:'commit',reviewed:true,source:'strava',candidates:result.candidates}).success,false);
 for(const invalid of [{...snapshot,sourceMessageId:''},{...snapshot,coverage:'complete'},{...snapshot,calories:-1}]){
  const parsed=importMeals(JSON.stringify({dailySummaries:[{id:'history',date,...invalid}]}));assert.equal(parsed.candidates.length,0);assert.equal(parsed.warnings.length,1);
 }
});
test('historical totals retain nulls and fuel is already included in calories',()=>{
 const result=summarize([historical],date,{now});
 assert.equal(result.totals.calories,2400);assert.equal(result.totals.fiber,null);assert.equal(result.etl.runFuelCalories.value,200);
 assert.equal(result.nutritionSource,'historical-summary');assert.equal(result.meals.length,0);assert.equal(result.nutrientCoverage.calories.complete,false);
 assert.equal(result.etl.beansG.value,null);
});
test('even one incomplete meal overrides a historical snapshot without filling gaps or adding totals',()=>{
 const data=[historical,record('meal','meal',meal)],result=summarize(data,date,{now}),progress=coachProgress(data,date);
 assert.equal(result.totals.calories,500);assert.equal(result.totals.carbs,null);assert.equal(result.nutritionSource,'meals');
 assert.equal(result.etl.runFuelCalories.value,null);assert.equal(progress.totals.calories,500);
 assert.equal(result.historicalSummary?.id,'history');
});
test('historical summaries never supply complete-day coach coverage and revisions invalidate context',()=>{
 const data=[historical,record('day','day',{complete:true,adjustment:0,adjustmentReason:'',feedback:''})];
 const progress=coachProgress(data,date),context=buildCoachContext(data,date,now);
 assert.equal(progress.foodComplete,false);assert.equal(progress.nutritionSource,'historical-summary');
 assert.equal(progress.flex.loggedPercent,null);assert.equal(progress.totals.calories,2400);
 assert.equal(context.history.at(-1)?.foodComplete,false);assert.equal(context.history.at(-1)?.nutritionSource,'historical-summary');
 assert.notEqual(coachContextFingerprint(data,date),coachContextFingerprint([{...historical,revision:2}],date));
 assert.equal(summarize([{...historical,deleted:true}],date,{now}).totals.calories,null);
});
