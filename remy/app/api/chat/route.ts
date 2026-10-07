import {z} from 'zod';
import {authorize,body,json,failure} from '@/lib/http';
import {listEntries,saveEntry,getEntry,operationGuard} from '@/lib/store';
import {summarize,addDays,ofKind,emptyDay,type Meal,type Day,type Entry} from '@/lib/domain';
import {insights} from '@/lib/insights';
import {dateSchema,mealSchema} from '@/lib/validation';

const requestSchema=z.object({message:z.string().trim().min(1).max(3000),date:dateSchema,id:z.string().uuid().optional()}).strict();
const amount='(-?(?:(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?|\\.\\d+))';
function suppliedAmount(message:string,unit:string,label?:string){
 const patterns=[new RegExp(`(?<![\\w.,])${amount}\\s*${unit}${label?`\\s*${label}`:''}\\b`,'gi')];
 if(label)patterns.push(new RegExp(`\\b${label}\\s*[:=]?\\s*${amount}\\s*${unit}\\b`,'gi'));
 const forward=[...message.matchAll(patterns[0])];
 const matches=forward.length?forward:patterns[1]?[...message.matchAll(patterns[1])]:[];
 const found=matches.map(match=>Number(match[1].replaceAll(',','')));
 if(found.length>1)throw new Error('Supply one total for each nutrient in this meal, or log the foods as separate entries.');
 return found[0]??null;
}
type StoredMessage={role?:string;text?:string;actionKind?:string;action?:{entry?:Entry<Meal>};commandTargetId?:string|null};
function lastConversationalMeal(entries:Entry[],date:string):Entry<Meal>|null{
 const replies=ofKind<StoredMessage>(entries,'message').filter(m=>m.localDate===date&&m.data.role==='assistant').sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
 const last=replies[0];if(!last||(replies[1]&&replies[1].updatedAt===last.updatedAt))return null;
 const saved=last.data.action?.entry;
 const isMealLog=last.data.actionKind==='log-meal'||(!last.data.actionKind&&last.data.text?.startsWith('Saved your meal.'));
 if(!isMealLog||saved?.kind!=='meal')return null;
 const actual=ofKind<Meal>(entries,'meal').find(m=>m.id===saved.id);
 return actual&&actual.localDate===date&&actual.revision===saved.revision?actual:null;
}
export async function POST(request:Request){
 try{
  const user=await authorize(request,true),guard=await operationGuard(user.userId),input=requestSchema.parse(await body(request)),{message,date}=input,id=input.id??crypto.randomUUID();
  const previousRequest=await getEntry(user.userId,`message:${id}`);
  if(previousRequest&&(previousRequest.localDate!==date||previousRequest.data.text!==message))throw new Error('This request ID was already used for another message. Start a new message.');
  const existingReply=await getEntry(user.userId,`reply:${id}`);if(existingReply)return json({message:existingReply,action:existingReply.data.action??null});
  const entries=await listEntries(user.userId),log=/^(breakfast|lunch|dinner|snack)(?:\s+(?:was|is)\s+|\s*:\s*)([\s\S]+)$/i.exec(message);
  const finished=/^(?:(?:i['’]m|i am)\s+)?(?:finished|done) logging(?: today)?[.!]?$/i.test(message),move=/^that was yesterday['’]s dinner[.!]?$/i.test(message);
  const correction=/^(actually|no cheese|there was no)\b/i.test(message);
  let parsedMeal:Meal|undefined;
  if(log){parsedMeal=mealSchema.parse({title:log[2].split('|')[0].trim(),mealType:log[1][0].toUpperCase()+log[1].slice(1).toLowerCase(),calories:suppliedAmount(message,'(?:kcal|calories)'),carbs:suppliedAmount(message,'(?:g|grams?)','(?:carbs?|carbohydrates?)'),protein:suppliedAmount(message,'(?:g|grams?)','protein'),fat:suppliedAmount(message,'(?:g|grams?)','fat'),fiber:suppliedAmount(message,'(?:g|grams?)','(?:fiber|fibre)'),mealTime:null,messageTime:previousRequest?.updatedAt??new Date().toISOString(),confidence:'unknown',notes:'Logged in the journal helper. Explicit nutrient values were supplied by the user; labels, recipes and portions still need review.',workoutId:null});}
  const conversational=lastConversationalMeal(entries,date);
  const rememberedTarget=typeof previousRequest?.data.commandTargetId==='string'?previousRequest.data.commandTargetId:null;
  const targetId=rememberedTarget??(move?conversational?.id:null)??null;
  if(!previousRequest)await saveEntry(user.userId,{guard,id:`message:${id}`,kind:'message',localDate:date,data:{role:'user',text:message,mode:'journal-helper',commandTargetId:targetId}});
  let action:Awaited<ReturnType<typeof saveEntry>>|null=null,actionKind:string|null=null,text='';
  if(finished){
   const old=ofKind<Day>(entries,'day').find(d=>d.localDate===date);
   action=await saveEntry(user.userId,{guard,id:`day:${date}`,kind:'day',localDate:date,data:{...emptyDay,...old?.data,complete:true},expectedRevision:old?.revision});actionKind='complete-day';
   text='Marked this day complete. Missing nutrient values still remain unknown.';
  }else if(parsedMeal){
   const priorMeal=await getEntry(user.userId,`meal:${id}`);
   if(priorMeal){if(priorMeal.kind!=='meal')throw new Error('The saved command has an incompatible record. Start a new message.');action={entry:priorMeal,duplicate:true};text=priorMeal.deleted?'This meal command was already saved and later deleted. It has not been restored.':'This meal command was already saved. Your current values and corrections are preserved.';}
   else{action=await saveEntry(user.userId,{guard,id:`meal:${id}`,kind:'meal',localDate:date,data:parsedMeal});text='Saved your meal. Unspecified nutrition stays unknown. Open the entry to add portions and Eat to Live contributions.';}
   actionKind='log-meal';
  }else if(move){
   const target=targetId?await getEntry(user.userId,targetId):null,yesterday=addDays(date,-1);
   if(!target||target.kind!=='meal'||target.deleted||(!rememberedTarget&&(!conversational||target.revision!==conversational.revision))){text='Choose the original meal in Food and change its date to yesterday. I could not identify one unchanged meal from the last conversational logging action.';}
   else if(rememberedTarget&&target.localDate===yesterday&&(target.data as unknown as Meal).mealType==='Dinner'){action={entry:target,duplicate:true};actionKind='move-meal';text='That meal is already saved as yesterday’s dinner; it was not moved again.';}
   else if(target.localDate!==date){text='That meal has changed date since the logging command. Choose the original in Food to confirm its date.';}
   else{const data=mealSchema.parse({...target.data,mealType:'Dinner',mealTime:null});action=await saveEntry(user.userId,{...target,guard,localDate:yesterday,data,expectedRevision:target.revision});actionKind='move-meal';text='Moved the meal from the last conversational logging action to yesterday’s dinner. Its original message time is preserved.';}
  }else if(correction){
   text=conversational?`Open “${conversational.data.title}” in Food to correct the original meal. Ingredient changes need a supplied label, recipe value or reviewed estimate; no nutrient subtraction has been invented.`:'Choose the original meal in Food to correct it. The last conversational action does not identify one unchanged meal.';
  }
  // Text, numeric results, evidence and fingerprints use one post-action snapshot.
  // If another request edits the data later, the UI can mark this answer stale.
  const fresh=await listEntries(user.userId),calculatedAt=new Date().toISOString(),summary=summarize(fresh,date,{now:calculatedAt}),brief=insights(fresh,date,{now:calculatedAt});
  if(!text){
   const target=`Your chosen calorie target is ${summary.target} kcal (${summary.baseline} baseline ${summary.adjustment>=0?'+':''}${summary.adjustment} manual adjustment).`;
   const carbs=`Recorded carbohydrate: ${summary.totals.carbs??'unknown'} g. ${summary.carbs.range?`The contextual reference is ${summary.carbs.range[0]}–${summary.carbs.range[1]} g/day, a broad guide rather than a quota.`:'Confirm current body weight before calculating a personalized carbohydrate range.'}`;
   const observations=brief.observations.filter(item=>['weekly-running','etl-recorded'].includes(item.id)).map(item=>`${item.title}: ${item.body}`);
   text=[brief.headline.body,`${target} ${carbs}`,summary.carbs.reason,...observations,...brief.actions.map((item,index)=>`${index+1}. ${item.title} ${item.body}`)].join('\n\n');
  }
  const references=[...new Map([brief.headline,...brief.actions].flatMap(item=>item.references).map(reference=>[reference.url,reference])).values()];
  const reply=await saveEntry(user.userId,{guard,id:`reply:${id}`,kind:'message',localDate:date,data:{role:'assistant',text,mode:'journal-helper',fingerprint:summary.fingerprint,contextFingerprint:brief.fingerprint,inputs:brief.inputs,generatedAt:calculatedAt,references,limitations:brief.limitations,action,actionKind,notice:'Deterministic journal helper. Live AI chat is deferred.'}});
  return json({message:reply.entry,action});
 }catch(error){return failure(error)}
}
