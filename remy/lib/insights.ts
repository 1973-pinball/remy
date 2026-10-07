import {CALCULATION_VERSION,NUTRITION_SOURCE,ETL_FIELDS,addDays,ofKind,round,summarize,weeklyTraining,type Entry,type Meal,type Day,type Plan,type Profile} from './domain';

export interface RecordLink{id:string;kind:string;date:string|null;revision:number;updatedAt:string;href:string}
export interface Reference{title:string;url:string}
export interface InsightItem{id:string;title:string;body:string;tone:'neutral'|'attention'|'supportive';recordLinks:RecordLink[];references:Reference[]}
export interface InsightReport{
 version:string;date:string;generatedAt:string;headline:InsightItem;actions:InsightItem[];observations:InsightItem[];
 coverage:{foodComplete:boolean;mealCount:number;knownCalories:number;knownCarbs:number;etlFieldsKnown:number;daysReviewed:number;completeDays:number;runningDistanceMissing:number;whoopCycleCount:number;latestInputAt:string|null;oldestInputAt:string|null};
 inputs:RecordLink[];fingerprint:string;limitations:string[];
}
const nutrition:Reference={title:'Joint sports-nutrition position paper',url:NUTRITION_SOURCE};
const whoop:Reference={title:'WHOOP physiological cycles',url:'https://developer.whoop.com/docs/developing/user-data/cycle/'};
const expenditure:Reference={title:'WHOOP expenditure methodology',url:'https://www.whoop.com/us/en/thelocker/calorie-tracking-science/'};
function recordLink(entry:Entry<unknown>):RecordLink{
 const view=entry.kind==='meal'||entry.kind==='day'?'Food':entry.kind==='profile'?'Settings':entry.kind==='connection'?'Connections':entry.kind==='workout'||entry.kind==='plan'?'Training':'Today';
 return{id:entry.id,kind:entry.kind,date:entry.localDate,revision:entry.revision,updatedAt:entry.updatedAt,href:`/?view=${view}${entry.localDate?`&date=${entry.localDate}`:''}&record=${encodeURIComponent(entry.id)}`};
}
function unique(entries:Entry<unknown>[]){return [...new Map(entries.map(e=>[e.id,e])).values()]}
function item(id:string,title:string,body:string,records:Entry<unknown>[],references:Reference[]=[],tone:InsightItem['tone']='neutral'):InsightItem{return{id,title,body,tone,recordLinks:unique(records).map(recordLink),references}}
function suitableMeal(profile:Profile){
 const restricted=/soy.{0,20}(allerg|free)|(?:avoid|no|allerg).{0,20}(soy|beans|legumes)|legume.{0,20}allerg/i.test(profile.diet);
 return restricted?'a familiar protein source that fits your dietary preferences, cooked vegetables, and a tolerated starch such as rice or potatoes':'beans or whole soy, cooked vegetables, and a tolerated starch such as rice or potatoes';
}
/** Deterministic, bounded advice over actual records. No model arithmetic and no
 * clinical diagnosis or inferred expenditure from Garmin workout calories. */
export function insights(entries:Entry[],date:string,options:{now?:string}={}):InsightReport{
 const summary=summarize(entries,date,options),week=weeklyTraining(entries,date),from=addDays(date,-6),profileEntries=ofKind<Profile>(entries,'profile');
 const meals=summary.meals,plans=summary.plans,cycles=summary.recovery,todayRuns=summary.workouts;
 const dayEntries=ofKind<Day>(entries,'day').filter(d=>d.localDate!>=from&&d.localDate!<=date),completeDays=dayEntries.filter(d=>d.data.complete).length;
 const dayEvidence=dayEntries.filter(d=>d.localDate===date),support=unique([...meals,...plans,...cycles,...todayRuns,...profileEntries,...dayEvidence]);
 const food=summary.totals.calories==null?'No calorie estimate is recorded':`${Math.round(summary.totals.calories).toLocaleString('en-US')} kcal logged${summary.day.complete?'':' so far'}`;
 const scored=summary.expenditure.filter(c=>c.kcal!=null),cycleText=scored.length===1?`WHOOP estimates ${scored[0].kcal!.toLocaleString('en-US')} kcal for its ${scored[0].end?'completed':'ongoing'} physiological cycle.`:scored.length>1?`${scored.length} WHOOP cycles overlap this date; their estimates are shown separately.`:'A scored WHOOP expenditure estimate is not available for this date.';
 let title='Start with one meal you can account for.';
 if(summary.meals.length)title=summary.nextLong?'Put the next long run on the menu.':summary.workouts.length?'Bring today’s food and running into view.':'Build the day from the meals you know.';
 const headline=item('daily-focus',title,`${food}. ${cycleText} ${!summary.day.complete?'The food log is incomplete, so unlogged intake remains unknown.':'Your chosen calorie target is '+summary.target.toLocaleString('en-US')+' kcal; it is a planning target, not a measured requirement.'}${scored.length?' The intake day and WHOOP cycle may cover different hours; no exact energy deficit is calculated.':''}`,support,scored.length?[whoop,expenditure]:[]);
 const actions:InsightItem[]=[];
 if(!summary.meals.length){actions.push(item('log-meal','Log or import a meal.','Start with a meal you remember, or review the selected REMY -- ETL conversation import. Keep uncertain portions and nutrients marked unknown.',profileEntries));}
 else if(!summary.day.complete||!summary.nutrientCoverage.calories.complete||!summary.nutrientCoverage.carbs.complete){actions.push(item('complete-picture','Finish the food record when you are ready.','Add unlogged meals and run fuel, and correct any known portions. Mark the day complete only when finished. Missing intake cannot establish that you ate too little.',[...meals,...dayEvidence]));}
 const next=summary.nextLong as Entry<Plan>|undefined;
 if(next){
  const grams=summary.carbs.range,logged=summary.totals.carbs;
  const reference=grams?`For the selected training context, the broad carbohydrate reference is ${grams[0]}–${grams[1]} g/day${logged!=null?`; ${round(logged)} g is recorded`:''}. `:'A confirmed current weight is needed before calculating a daily carbohydrate range. ';
  actions.push(item('next-meal','Make the next meal support the upcoming run.',`${next.data.title} is planned for ${next.localDate}. ${reference}An ETL-compatible option is ${suitableMeal(summary.profile)}. Adjust portions to your usual appetite and tolerance. Close to running, use the fiber level and foods that you already tolerate; run fuel counts as food intake too.`,[next,...meals,...profileEntries],[nutrition],'supportive'));
  if(next.data.durationSec!=null&&next.data.durationSec>=3600){
   const long=next.data.durationSec>9000,rate=long?'30–60 g/hour is a useful reference to review; longer efforts may support up to 90 g/hour with practiced tolerance and suitable carbohydrate sources':'30–60 g/hour is the published reference for endurance efforts of 1–2.5 hours';
   actions.push(item('run-fuel','Check the labels on the fuel you will carry.',`${rate}. Choose a rate you have practiced, then calculate gels and drinks from their labels. Record them against the run once; do not add a second meal for the same fuel.`,[next,...profileEntries],[nutrition]));
  }
 }else if(summary.meals.length){
  const recorded=ETL_FIELDS.filter(k=>summary.etl[k].value!=null);
  actions.push(item('etl-meal','Keep ETL meals compatible with your training.',`For a next-meal option, combine ${suitableMeal(summary.profile)}. ${recorded.length?'Some ETL quantities are recorded; unrecorded categories remain unknown.':'Add ETL quantities when known so vegetables, beans, fruit and starch can be considered alongside running.'} No category limit or quota has been assumed.`,[...meals,...profileEntries],[nutrition],'supportive'));
 }
 if(actions.length<3&&!summary.carbs.range)actions.push(item('confirm-weight','Confirm weight before personalizing carbohydrate grams.','The app can show logged carbohydrates and general fueling context now. Confirm or update your current weight in your profile to calculate g/kg and a daily reference range.',profileEntries,[nutrition]));
 const observations:InsightItem[]=[];
 if(week.count){const miles=round(week.km/1.609344);observations.push(item('weekly-running',`${miles} miles recorded this week`,`${week.count} completed run${week.count===1?'':'s'} across ${week.days} day${week.days===1?'':'s'} from ${week.start} to ${week.end}. ${week.missingDistance?`${week.missingDistance} run${week.missingDistance===1?' has':'s have'} missing distance; the total is partial.`:'This is recorded mileage, not a complete-coverage guarantee.'}`,week.runs));}
 if(summary.meals.length){
  const etl=summary.etl,parts:string[]=[];
  for(const [key,label,unit] of [['rawVegetablesG','raw vegetables','g'],['cookedVegetablesG','cooked vegetables','g'],['beansG','beans','g'],['soyG','whole soy','g'],['fruitServings','fruit','servings'],['starchCups','starch','cups']] as const){if(etl[key].value!=null)parts.push(`${etl[key].value} ${unit} ${label}`)}
  observations.push(item('etl-recorded','ETL quantities recorded',parts.length?`${parts.join('; ')}. These are known amounts only; missing categories are not zero and no daily ETL quotas have been assumed.`:'ETL category quantities have not been entered for these meals. Nutrition totals alone do not reveal the amounts of vegetables, beans, fruit or starch.',meals));
 }
 if(completeDays)observations.push(item('coverage','Food coverage over the last seven days',`${completeDays} of the seven dates from ${from} through ${date} are marked complete. Any other date remains incomplete or unknown; lower recorded intake on those dates is not evidence of lower actual intake.`,dayEntries));
 const allInputs=unique([...support,...week.runs,...dayEntries,...ofKind(entries,'connection')]);
 const times=allInputs.map(e=>e.updatedAt).filter(Boolean).sort();
 const limitations=[...summary.limitations];
 if(week.missingDistance)limitations.push('Weekly running mileage includes only runs with recorded distance.');
 if(!ETL_FIELDS.some(k=>summary.etl[k].value!=null))limitations.push('ETL category amounts are unknown until recorded; no daily food-group targets are assumed.');
 return{version:CALCULATION_VERSION,date,generatedAt:summary.generatedAt,headline,actions:actions.slice(0,3),observations,coverage:{foodComplete:summary.day.complete,mealCount:summary.meals.length,knownCalories:summary.nutrientCoverage.calories.known,knownCarbs:summary.nutrientCoverage.carbs.known,etlFieldsKnown:ETL_FIELDS.filter(k=>summary.etl[k].value!=null).length,daysReviewed:7,completeDays,runningDistanceMissing:week.missingDistance,whoopCycleCount:summary.recovery.length,latestInputAt:times.at(-1)??null,oldestInputAt:times[0]??null},inputs:allInputs.map(recordLink),fingerprint:`${CALCULATION_VERSION}:${date}:${allInputs.map(e=>`${e.id}:${e.revision}`).sort().join('|')}`,limitations};
}

