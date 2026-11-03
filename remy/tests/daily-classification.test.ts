import test from 'node:test';
import assert from 'node:assert/strict';
import { foodClassificationFingerprint, type DailyNutritionClassification } from '../lib/daily-classification';
import { nutritionHistory } from '../lib/nutrition-history';
import { coachProgress } from '../lib/coach-context';
import { dailyClassificationSchema } from '../lib/validation';
import type { Entry } from '../lib/domain';
const date='2026-11-02';
const meal:Entry={id:'meal',kind:'meal',localDate:date,source:'remy-etl',sourceId:'meal',revision:1,updatedAt:'2026-11-03T12:00:00Z',data:{calories:2000,protein:120,carbs:250,fat:65,fiber:40}};
const annotation=(changes:Partial<DailyNutritionClassification>={}):Entry=>({id:`day:${date}`,kind:'day',localDate:date,source:'manual',sourceId:`day:${date}`,revision:1,updatedAt:meal.updatedAt,data:{complete:false,adjustment:0,adjustmentReason:'',feedback:'',nutritionClassification:{version:1,totalCalories:2000,regularFlexCalories:400,runFuelCalories:null,convention:'training-fuel-neutral',sourceMessageIds:['source-final'],sourceConversationId:'remy-etl',notes:'Reviewed final source summary.',foodFingerprint:foodClassificationFingerprint([meal],date),reviewedAt:meal.updatedAt,...changes}}});

test('daily source classification fills missing meal fields without adding food or assuming missing fuel is zero',()=>{
 const records=[meal,annotation()],before=structuredClone(records),day=nutritionHistory(records,date,'all')[0];
 assert.equal(day.etlPercent,80);assert.equal(day.flexPercent,20);assert.equal(day.runFuelPercent,null);
 assert.equal(day.calories,2000);assert.equal(day.protein,120);assert.equal(day.shareBasis,'daily-conversation-estimate');
 const coach=coachProgress(records,date);assert.equal(coach.flex.value,400);assert.equal(coach.flex.loggedPercent,20);assert.equal(coach.foodComplete,false);
 assert.deepEqual(records,before);
});
test('meal corrections, added food and deleted source food invalidate the old daily annotation',()=>{
 for(const foods of [[{...meal,revision:2,data:{...meal.data,calories:2100}}],[meal,{...meal,id:'new'}],[{...meal,deleted:true}]]){
  const result=nutritionHistory([...foods,annotation()],date,'all')[0];
  assert.equal(result.etlPercent,null);assert.equal(result.shareStatus,'stale-classification');
 }
});
test('source ranges remain visible and legacy conventions remain marked',()=>{
 const result=nutritionHistory([meal,annotation({regularFlexCalories:null,regularFlexRange:[400,600],convention:'historical-flex-including-any-run-fuel'})],date,'all')[0];
 assert.equal(result.etlPercent,75);assert.deepEqual(result.etlPercentRange,[70,80]);
 assert.equal(result.shareBasis,'historical-conversation-estimate');assert.match(result.shareNotes!,/midpoint/);
 assert.equal(dailyClassificationSchema.safeParse((annotation({regularFlexRange:[600,400]}).data.nutritionClassification)).success,false);
 assert.equal(dailyClassificationSchema.safeParse((annotation({regularFlexCalories:2100}).data.nutritionClassification)).success,false);
});
