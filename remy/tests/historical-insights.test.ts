import test from 'node:test';
import assert from 'node:assert/strict';
import {insights} from '../lib/insights';
import {type Entry} from '../lib/domain';

const date='2026-09-30',now='2026-10-20T12:00:00Z';
const entry=(id:string,kind:Entry['kind'],localDate:string,data:Record<string,unknown>):Entry=>({
 id,kind,localDate,data,source:'test',sourceId:id,revision:1,updatedAt:'2026-10-20T10:00:00Z',
});
const history=(id='history',day=date)=>entry(id,'dailySummary',day,{
 calories:2300,protein:130,carbs:300,fat:70,fiber:40,
 notes:'Synthetic source daily estimate',sourceMessageId:'synthetic-source',coverage:'unknown',confidence:'estimate',
});
const complete=(day=date)=>entry(`day:${day}`,'day',day,{complete:true,adjustment:0,adjustmentReason:'',feedback:''});
const meal=(id='meal',day=date)=>entry(id,'meal',day,{
 title:'Synthetic meal',mealType:'Lunch',mealTime:null,messageTime:null,notes:'',confidence:'estimate',workoutId:null,
 calories:500,protein:30,carbs:60,fat:15,fiber:10,
});

test('historical insight identifies its source and cannot inherit a complete-day flag',()=>{
 const report=insights([history(),complete()],date,{now});
 assert.match(report.headline.body,/historical daily estimate is 2,300 kcal/);
 assert.match(report.headline.body,/full-day food coverage are unknown/);
 assert.doesNotMatch(report.headline.body,/kcal logged|so far/);
 assert.equal(report.coverage.foodComplete,false);
 assert.equal(report.coverage.completeDays,0);
 assert.equal(report.coverage.mealCount,0);
 assert.ok(report.actions.some(action=>action.id==='review-history'));
 assert.ok(!report.actions.some(action=>action.id==='log-meal'));
 const link=report.headline.recordLinks.find(link=>link.id==='history');
 assert.match(link!.href,/\?view=Food&date=2026-09-30/);
 assert.ok(report.inputs.some(link=>link.id==='history'));
 assert.match(report.fingerprint,/history:1/);
 const revised={...history(),revision:2,data:{...history().data,calories:2400}};
 assert.notEqual(insights([revised,complete()],date,{now}).fingerprint,report.fingerprint);
});

test('a meal ledger takes precedence without adding the retained historical estimate',()=>{
 const report=insights([history(),meal(),complete()],date,{now});
 assert.match(report.headline.body,/500 kcal logged/);
 assert.doesNotMatch(report.headline.body,/(?:2,300|2,800) kcal logged|historical daily estimate is/);
 assert.equal(report.coverage.foodComplete,true);
 assert.equal(report.coverage.completeDays,1);
 assert.equal(report.coverage.mealCount,1);
 assert.ok(report.inputs.some(link=>link.id==='history'),'Retained-source comparison has provenance');
 assert.ok(report.limitations.some(text=>/Only the meal ledger contributes/.test(text)));
});

test('seven-day coverage excludes historical-only dates and tracks the evidence that changes that decision',()=>{
 const rows=[
  history('older-history','2026-09-28'),complete('2026-09-28'),
  history('mixed-history','2026-09-29'),meal('older-meal','2026-09-29'),complete('2026-09-29'),
  meal(),complete(),
 ];
 const report=insights(rows,date,{now});
 assert.equal(report.coverage.completeDays,2);
 assert.ok(report.observations.some(item=>item.id==='coverage'&&item.body.startsWith('2 of the seven dates')));
 assert.ok(report.inputs.some(link=>link.id==='older-history'));
 assert.ok(report.inputs.some(link=>link.id==='older-meal'));
 const withDeletedMeal=rows.map(row=>row.id==='older-meal'?{...row,deleted:true}:row);
 const changed=insights(withDeletedMeal,date,{now});
 assert.equal(changed.coverage.completeDays,1);
 assert.notEqual(changed.fingerprint,report.fingerprint);
 const outside=history('outside-window','2026-09-23');
 assert.equal(insights([...rows,outside],date,{now}).fingerprint,report.fingerprint);
});

test('deleted summaries do not supply intake or source evidence',()=>{
 const report=insights([{...history(),deleted:true}],date,{now});
 assert.match(report.headline.body,/No calorie estimate is recorded/);
 assert.ok(report.actions.some(action=>action.id==='log-meal'));
 assert.ok(!report.inputs.some(link=>link.id==='history'));
});
