import test from 'node:test';
import assert from 'node:assert/strict';
import { nutritionHistory } from '../lib/nutrition-history';
import type { Entry, Kind } from '../lib/domain';
const day = '2026-11-02';
const data = {calories:2000,protein:120,carbs:250,fat:65,fiber:40,etl:{flexCalories:200,runFuelCalories:300}};
const entry = (id:string, kind:Kind, values:object = data, date=day):Entry => ({id,kind,localDate:date,source:'test',sourceId:id,revision:1,updatedAt:'2026-11-03T12:00:00Z',data:values as Record<string,unknown>});
test('history uses latest historical estimates until meals replace the whole date', () => {
 const summaries=[entry('old','dailySummary',{...data,calories:9999}),{...entry('new','dailySummary'),updatedAt:'2026-11-03T13:00:00Z'}];
 const historical=nutritionHistory(summaries,day,'all')[0];
 assert.equal(historical.calories,2000);assert.equal(historical.source,'historical-summary');assert.equal(historical.foodComplete,false);
 assert.equal(historical.etlPercent,75);assert.equal(historical.flexPercent,10);assert.equal(historical.runFuelPercent,15);
 const meal=nutritionHistory([...summaries,entry('meal','meal',{...data,calories:500,etl:{flexCalories:0,runFuelCalories:0}})],day,'all')[0];
 assert.equal(meal.calories,500);assert.equal(meal.source,'meals');assert.equal(meal.etlPercent,100);
});
test('known partial sums retain coverage while entirely unknown days and nutrients stay gaps', () => {
 const rows=nutritionHistory([entry('known','meal',{...data,fiber:null}),entry('partial','meal',{...data,calories:null,protein:null,fiber:null})],day,7);
 assert.equal(rows.length,7);assert.equal(rows[0].calories,null);assert.equal(rows[0].etlPercent,null);
 const last=rows.at(-1)!;assert.equal(last.calories,2000);assert.equal(last.protein,120);assert.equal(last.fiber,null);
 assert.deepEqual(last.coverage.calories,{known:1,total:2,complete:false});assert.equal(last.shareStatus,'missing-calories');
 assert.equal(last.etlPercent,null);
});
test('flex and running fuel partition energy once and unknown classifications never become zero', () => {
 const rows=nutritionHistory([entry('food','meal',{...data,calories:1800,etl:{flexCalories:200,runFuelCalories:0}}),entry('fuel','meal',{...data,calories:200,etl:{flexCalories:0,runFuelCalories:200}})],day,'all');
 const result=rows[0];assert.equal(result.calories,2000);assert.equal(result.etlPercent,80);assert.equal(result.flexPercent,10);assert.equal(result.runFuelPercent,10);
 for(const etl of [{flexCalories:200},{runFuelCalories:200},{flexCalories:0,runFuelCalories:null}]){
  const partial=nutritionHistory([entry('meal','meal',{...data,etl})],day,'all')[0];
  assert.equal(partial.shareStatus,'missing-classification');assert.equal(partial.flexPercent,null);assert.equal(partial.runFuelPercent,null);
 }
});
test('per-record overlap and zero-energy ratios are rejected without clipping or hiding behind other meals', () => {
 const invalid=nutritionHistory([entry('overlap','meal',{...data,calories:100,etl:{flexCalories:80,runFuelCalories:80}}),entry('other','meal',data)],day,'all')[0];
 assert.equal(invalid.shareStatus,'invalid-classification');assert.equal(invalid.etlPercent,null);
 const zero=nutritionHistory([entry('zero','meal',{...data,calories:0,etl:{flexCalories:0,runFuelCalories:0}})],day,'all')[0];
 assert.equal(zero.calories,0);assert.equal(zero.shareStatus,'zero-calories');assert.equal(zero.flexPercent,null);
});
test('calendar ranges insert missing dates and exclude deleted or later nutrition without counting workouts', () => {
 const records=[entry('first','dailySummary',data,'2026-10-31'),entry('last','meal'),{...entry('deleted','meal',data,'2026-10-29'),deleted:true},entry('future','meal',data,'2026-11-03'),entry('run','workout',{calories:800},'2026-10-30')];
 const before=structuredClone(records),rows=nutritionHistory(records,day,'all');
 assert.deepEqual(rows.map(r=>r.date),['2026-10-31','2026-11-01','2026-11-02']);assert.equal(rows[1].calories,null);
 assert.equal(rows[2].calories,2000);assert.deepEqual(records,before);
});
