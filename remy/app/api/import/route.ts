import {authorize,body,json,failure} from '@/lib/http';
import {importMeals,importCalendar,importStrava,importFit,reconcileMealImport} from '@/lib/imports';
import {hash,listEntries,saveEntry,uploadOriginal,operationGuard} from '@/lib/store';
import {persistWorkout} from '@/lib/connections';
import {profileOf,type Meal,type Plan,type Entry} from '@/lib/domain';
import {importCommitSchema} from '@/lib/validation';

export async function POST(request:Request){
 try{
  const user=await authorize(request,true),initialGuard=await operationGuard(user.userId),b=await body(request);
  const validated=b.action==='preview'?null:importCommitSchema.parse(b);
  const providerGuard=validated?await operationGuard(user.userId,validated.source):initialGuard;
  const guard={...providerGuard,generation:initialGuard.generation};
  const entries=await listEntries(user.userId,true),zone=profileOf(entries).timezone;
  if(b.action==='preview'){
   const text=String(b.text??'');if(text.length>1_500_000)throw new Error('Import must be under 1.5 MB. Split larger exports first.');
   const preview=b.format==='fit'?await importFit(text,zone):b.format==='ics'?importCalendar(text,zone):b.format==='strava'?importStrava(text,zone):importMeals(text,zone);
   return json(preview);
  }
  // Validate every candidate before storing an original or writing any records.
  const input=validated!,{source}=input,original=input.original??'';
  const digest=await hash(original||JSON.stringify(input.candidates)),importId=`import:${source}:${digest}`;
  let originalStored=false;if(original){await uploadOriginal(user.userId,`imports/${digest}`,original,guard);originalStored=true}
  let added=0,updated=0,duplicates=0,matched=0;
  const conflicts:{key:string;recordId:string;reason:string;incoming:unknown}[]=[];
  for(const item of input.candidates){
   if(item.kind==='workout'){
    const result=await persistWorkout(user.userId,source,item.key,item.data,{candidate:item,importDigest:digest},zone,guard);
    if(result.updated)updated++;else if(result.matched)matched++;else if(result.duplicate)duplicates++;else added++;
    continue;
   }
   const sourceId=item.key,id=`${source}:${item.kind}:${await hash(sourceId)}`;
   const existing=entries.find(e=>e.kind===item.kind&&e.source===source&&e.sourceId===sourceId);
   if(item.kind==='meal'){
    const decision=reconcileMealImport(existing as Entry<Meal>|undefined,item);
    if(decision.action==='duplicate'){duplicates++;continue}
    if(decision.action==='preserve'){conflicts.push({key:item.key,recordId:existing!.id,reason:decision.reason,incoming:item});continue}
   }
   if(existing?.deleted){conflicts.push({key:item.key,recordId:existing.id,reason:'This record was deleted locally and was not restored by the import.',incoming:item});continue}
   const oldPlan=existing?.data as unknown as Plan|undefined;
   const data=item.kind==='plan'&&existing?{...item.data,completedWorkoutId:oldPlan!.completedWorkoutId,...(oldPlan!.originalDate||existing.localDate!==item.date?{originalDate:oldPlan!.originalDate??existing.localDate??item.date}:{})}:item.data;
   const result=await saveEntry(user.userId,{guard,id:existing?.id??id,kind:item.kind,localDate:item.date,source,sourceId,data,expectedRevision:existing?.revision});
   if(result.duplicate)duplicates++;else if(existing)updated++;else added++;
   const index=entries.findIndex(e=>e.id===result.entry.id);if(index<0)entries.push(result.entry);else entries[index]=result.entry;
  }
  // A repeated import is a replay, not a fresh observation. Preserve its first
  // audit timestamp and only revise it if its outcome actually changes.
  const previous=entries.find(e=>e.id===importId);
  await saveEntry(user.userId,{guard,id:importId,kind:'import',localDate:null,source,sourceId:digest,data:{digest,added,updated,duplicates,matched,reviewed:true,importedAt:previous?.data.importedAt??new Date().toISOString(),originalStored,conflicts},expectedRevision:previous?.revision});
  return json({added,updated,duplicates,matched,conflicts});
 }catch(e){return failure(e)}
}
