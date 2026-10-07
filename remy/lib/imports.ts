import {localDate,zonedInstant,type Meal,type Plan,type Workout} from './domain';
import {dateSchema,mealSchema,workoutSchema,planSchema,importCandidateSchema} from './validation';
import type {z} from 'zod';
export type Candidate=z.infer<typeof importCandidateSchema>;
export interface ImportPreview{candidates:Candidate[];warnings:string[];source:string;rawCount:number}
const numeric=(value:unknown)=>value==null||value===''?null:Number.isFinite(Number(value))?Number(value):null;
const emptyMeal={mealTime:null,messageTime:null,notes:'Imported REMY entry',confidence:'unknown' as const,workoutId:null,calories:null,carbs:null,protein:null,fat:null,fiber:null};

export function parseCsv(text:string){
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++}else quoted=!quoted}else if(c===','&&!quoted){row.push(cell);cell=''}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(Boolean))rows.push(row);row=[];cell=''}else cell+=c}
 row.push(cell);if(row.some(Boolean))rows.push(row);if(quoted)throw new Error('CSV has an unclosed quoted field.');if(rows[0]?.[0])rows[0][0]=rows[0][0].replace(/^\uFEFF/,'');return rows;
}
export function importStrava(text:string,zone:string):ImportPreview{
 const [headers,...rows]=parseCsv(text);if(!headers?.includes('Activity ID'))throw new Error('Expected the Strava activities.csv export with Activity ID.');
 const warnings:string[]=[],candidates:Candidate[]=[];
 for(const cells of rows){const r=Object.fromEntries(headers.map((h,i)=>[h,cells[i]??'']));if(!/run/i.test(r['Activity Type']))continue;
  try{if(!r['Activity ID'])throw new Error('Missing Activity ID');const raw=r['Activity Date'];let start:string;
   if(/(?:Z|[+-]\d\d:\d\d)$/.test(raw))start=new Date(raw).toISOString();
   else if(/^\d{4}-/.test(raw))start=zonedInstant(raw.replace(' ','T'),zone);
   else start=new Date(raw+' UTC').toISOString();
   // Strava's extended duplicate Distance column is in metres. The leading,
   // display-unit column may reflect account preferences and is not inferred.
   const last=headers.lastIndexOf('Distance'),distance=last!==headers.indexOf('Distance')?numeric(cells[last]):null;
   const data=workoutSchema.parse({title:r['Activity Name']||'Imported run',start,durationSec:numeric(r['Moving Time']||r['Elapsed Time']),distanceMeters:distance,avgHr:numeric(r['Average Heart Rate']),calories:numeric(r['Calories']),elevationMeters:numeric(r['Elevation Gain']),sport:'running',notes:'Strava export. Distance remains unknown when the extended field is absent.'});
   candidates.push({key:r['Activity ID'],kind:'workout',date:localDate(start,zone),data,warning:distance==null?'Distance units are not explicit; enter kilometers after review.':undefined});
  }catch{warnings.push(`Skipped activity ${r['Activity ID']}: invalid or ambiguous date or values.`)}
 }
 return{candidates,warnings,source:'strava',rawCount:rows.length};
}
/** Decode one original FIT or FIT.GZ file, supplied as base64 by the file picker.
 * The decompressed-byte digest makes .FIT and .FIT.GZ copies share identity. */
export async function importFit(base64:string,zone:string):Promise<ImportPreview>{
 if(!base64||base64.length>1_500_000||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)||base64.length%4!==0)throw new Error('Use a FIT or FIT.GZ file under 1 MB; its upload must be valid base64.');
 let bytes:Buffer=Buffer.from(base64,'base64');
 if(bytes[0]===0x1f&&bytes[1]===0x8b){const{gunzipSync}=await import('node:zlib');try{bytes=gunzipSync(bytes,{maxOutputLength:8_000_000})}catch{throw new Error('The compressed FIT file is invalid or expands beyond the 8 MB limit.')}}
 const{Decoder,Stream}=await import('@garmin/fitsdk'),decoder=new Decoder(Stream.fromBuffer(bytes));
 if(!decoder.isFIT()||!decoder.checkIntegrity())throw new Error('The FIT file failed its format or integrity check. Export the original file again.');
 const{messages,errors}=decoder.read();if(errors.length)throw new Error('The FIT file could not be decoded completely. No partial activity was imported.');
 const{createHash}=await import('node:crypto'),digest=createHash('sha256').update(bytes).digest('hex');
 const sessions=messages.sessionMesgs??[],candidates:Candidate[]=[],warnings:string[]=[];
 for(const[index,session]of sessions.entries()){
  if(session.sport!=='running')continue;
  try{
   const start=session.startTime instanceof Date?session.startTime.toISOString():null;if(!start)throw new Error('No session start time');
   const laps=(messages.lapMesgs??[]).filter(lap=>lap.startTime instanceof Date&&lap.startTime.getTime()>=Date.parse(start)&&(session.timestamp instanceof Date?lap.startTime.getTime()<=session.timestamp.getTime():true));
   const data=workoutSchema.parse({title:'Imported FIT run',start,durationSec:numeric(session.totalTimerTime??session.totalElapsedTime),distanceMeters:numeric(session.totalDistance),avgHr:numeric(session.avgHeartRate),calories:numeric(session.totalCalories),elevationMeters:numeric(session.totalAscent),sport:'running',notes:'Original FIT decoded with the official Garmin SDK. Headline session metrics and laps are imported; the retained original includes recorded streams.',laps:JSON.parse(JSON.stringify(laps.slice(0,5000),(_key,value)=>typeof value==='bigint'?value.toString():value))});
   candidates.push({key:`${digest}:session:${index}`,kind:'workout',date:localDate(start,zone),data});
   if(laps.length>5000)warnings.push('Only the first 5,000 laps are normalized; the original retains all records.');
  }catch{warnings.push(`Running session ${index+1} has invalid or missing required fields and was skipped.`)}
 }
 if(!candidates.length)warnings.push('No complete running sessions were found. Non-running sessions were excluded.');
 return{candidates,warnings,source:'fit',rawCount:sessions.length};
}
function unescapeIcal(s:string){return s.replace(/\\n/gi,'\n').replace(/\\([,;\\])/g,'$1')}
export function importCalendar(text:string,zone:string):ImportPreview{
 if(!text.includes('BEGIN:VCALENDAR'))throw new Error('Expected an iCalendar .ics file.');
 const blocks=text.replace(/\r?\n[ \t]/g,'').split('BEGIN:VEVENT').slice(1),candidates:Candidate[]=[],warnings:string[]=[];
 for(const block of blocks){
  const fields=block.split('END:VEVENT')[0].split(/\r?\n/).filter(line=>line.includes(':')).map(line=>{const at=line.indexOf(':');return{key:line.slice(0,at),value:line.slice(at+1)}});
  const f=(k:string)=>fields.find(p=>p.key.split(';')[0]===k),dt=f('DTSTART'),uid=f('UID');
  if(!dt||!uid){warnings.push('Event without UID or DTSTART was skipped.');continue}
  if(f('RRULE')){warnings.push(`Recurring event ${f('SUMMARY')?.value??uid.value} requires a feed with expanded occurrences; skipped.`);continue}
  try{
   const allDay=dt.key.includes('VALUE=DATE')||dt.value.length===8,date=`${dt.value.slice(0,4)}-${dt.value.slice(4,6)}-${dt.value.slice(6,8)}`;dateSchema.parse(date);
   const format=(s:string)=>`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(9,11)}:${s.slice(11,13)}:${s.slice(13,15)||'00'}${s.endsWith('Z')?'Z':''}`;
   const tz=/TZID=([^;]+)/.exec(dt.key)?.[1]?.replace(/^"|"$/g,'')??zone,start=allDay?null:zonedInstant(format(dt.value),tz),end=f('DTEND');
   const endTime=!allDay&&end?zonedInstant(format(end.value),/TZID=([^;]+)/.exec(end.key)?.[1]?.replace(/^"|"$/g,'')??tz):null;
   if(start&&endTime&&Date.parse(endTime)<Date.parse(start))throw new Error('Event ends before it starts');
   const data=planSchema.parse({title:unescapeIcal(f('SUMMARY')?.value??'Planned workout'),start,allDay,durationSec:start&&endTime?(Date.parse(endTime)-Date.parse(start))/1000:null,distanceMeters:null,intensity:'Not supplied',notes:unescapeIcal(f('DESCRIPTION')?.value??''),completedWorkoutId:null,cancelled:f('STATUS')?.value==='CANCELLED'});
   candidates.push({key:uid.value+(f('RECURRENCE-ID')?`:${f('RECURRENCE-ID')!.value}`:''),kind:'plan',date:allDay?date:localDate(start!,zone),data});
  }catch{warnings.push(`Event ${uid.value} had an invalid or ambiguous time and was skipped. Supply an offset for repeated DST times.`)}
 }
 return{candidates,warnings,source:'runna',rawCount:blocks.length};
}

type ExportMessage={id?:string;author?:{role?:string};role?:string;content?:unknown;create_time?:number;timestamp?:string};
type ExportNode={id?:string;parent?:string|null;children?:string[];message?:ExportMessage|null};
type Conversation={id?:string;title?:string;current_node?:string;mapping?:Record<string,ExportNode>;messages?:ExportMessage[]};
const isObject=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function messageText(content:unknown):string{
 if(typeof content==='string')return content;
 if(isObject(content)&&Array.isArray(content.parts))return content.parts.filter((part):part is string=>typeof part==='string').join('\n');
 if(Array.isArray(content))return content.filter(isObject).map(part=>typeof part.text==='string'?part.text:'').join('\n');
 return '';
}
function conversationMessages(conversation:Conversation){
 if(Array.isArray(conversation.messages))return conversation.messages;
 const mapping=conversation.mapping;if(!mapping)return [];
 let current=conversation.current_node;
 if(!current){const leaves=Object.entries(mapping).filter(([,node])=>!node.children?.length);if(leaves.length!==1)throw new Error('This conversation has multiple branches. Export its selected branch or paste the selected transcript.');current=leaves[0][0]}
 const messages:ExportMessage[]=[],seen=new Set<string>();
 while(current){if(seen.has(current))throw new Error('Conversation contains a cyclic branch.');seen.add(current);const node:ExportNode|undefined=mapping[current];if(!node)throw new Error('Selected conversation branch is incomplete.');if(node.message)messages.unshift({...node.message,id:node.message.id??node.id??current});current=node.parent??undefined}
 return messages;
}
export function importConversation(conversation:Conversation,zone='America/New_York'):ImportPreview{
 const messages=conversationMessages(conversation),candidates:Candidate[]=[],warnings:string[]=['Only user-authored entries from the selected conversation branch are candidates. Assistant nutrition estimates, summaries and daily totals are excluded. Review later corrections before saving.'];
 for(const [index,message] of messages.entries()){
  if((message.author?.role??message.role)!=='user')continue;
  const text=messageText(message.content);if(!text.trim())continue;
  let timestamp:string|null=null;try{timestamp=message.timestamp?new Date(message.timestamp).toISOString():typeof message.create_time==='number'?new Date(message.create_time*1000).toISOString():null}catch{warnings.push(`Message ${index+1} has an invalid timestamp.`)}
  const preview=importTranscript(text,{defaultDate:timestamp?localDate(timestamp,zone):null,messageTime:timestamp,messageId:message.id??`${conversation.id??'selected'}:message:${index}`});
  candidates.push(...preview.candidates);if(/actually|correction|no cheese|yesterday/i.test(text))warnings.push(`Message ${message.id??index+1} contains a correction or date change; reconcile it against earlier meals.`);
 }
 if(!candidates.length)warnings.push('No explicit meals were found. Use the structured meal template to reconcile this conversation without inventing intake.');
 return{candidates,warnings,source:'remy-etl',rawCount:messages.length};
}
export function importMeals(text:string,zone='America/New_York'):ImportPreview{
 let raw:unknown;try{raw=JSON.parse(text)}catch{return importTranscript(text)}
 if(isObject(raw)&&(isObject(raw.mapping)||Array.isArray(raw.messages)))return importConversation(raw as Conversation,zone);
 if(Array.isArray(raw)&&raw.some(row=>isObject(row)&&(isObject(row.mapping)||Array.isArray(row.messages)))){
  const conversations=raw.filter(row=>isObject(row)&&(isObject(row.mapping)||Array.isArray(row.messages))) as Conversation[];
  const selected=conversations.length===1?conversations[0]:conversations.filter(c=>/^REMY\s*[-–—]+\s*ETL$/i.test(c.title??''));
  if(Array.isArray(selected)&&selected.length!==1)throw new Error('Export one selected REMY conversation; this file contains multiple conversations and no unique REMY -- ETL selection.');
  return importConversation(Array.isArray(selected)?selected[0]:selected,zone);
 }
 const rows=Array.isArray(raw)?raw:isObject(raw)?raw.meals:undefined;if(!Array.isArray(rows))throw new Error('Use a meals array, a selected conversation JSON export, or a dated transcript.');
 const candidates:Candidate[]=[],warnings:string[]=[],occurrences=new Map<string,number>();
 for(const [i,value] of rows.entries()){
  if(!isObject(value)){warnings.push(`Row ${i+1} is not a meal object.`);continue}const r=value;
  if(r.type==='total'||r.role==='assistant'||/daily total|cumulative|summary/i.test(String(r.type??''))||/^(?:daily\s+)?(?:total|summary)\b/i.test(String(r.title??r.description??''))){warnings.push(`Skipped summary row ${i+1}.`);continue}
  try{
   const date=dateSchema.parse(r.date??r.localDate),data=mealSchema.parse({...emptyMeal,title:r.title??r.description,mealType:r.mealType??'Snack',mealTime:r.mealTime??null,messageTime:r.messageTime??null,notes:r.notes??'Imported REMY entry',confidence:r.confidence??'estimate',calories:numeric(r.calories),carbs:numeric(r.carbs),protein:numeric(r.protein),fat:numeric(r.fat),fiber:numeric(r.fiber),...(r.etl?{etl:r.etl}:{})});
   const slot=`${date}:${data.mealType}`,occurrence=(occurrences.get(slot)??0)+1;occurrences.set(slot,occurrence);
   const key=r.id!=null?String(r.id):`${slot}:occurrence:${occurrence}`;
   const warning=r.id==null?'No source ID: matching uses date, meal type and occurrence order. Keep order stable or supply IDs. Existing meals are never overwritten by this import.':data.confidence==='estimate'?'Imported estimate. Confirm portions and nutrition.':undefined;
   candidates.push({key,kind:'meal',date,data,warning});
  }catch{warnings.push(`Row ${i+1} needs review: include date, title and valid nutrition.`)}
 }
 return{candidates,warnings,source:'remy-etl',rawCount:rows.length};
}
export function importTranscript(text:string,context:{defaultDate?:string|null;messageTime?:string|null;messageId?:string}={}):ImportPreview{
 const candidates:Candidate[]=[],warnings:string[]=['Transcript extraction is conservative. Review every candidate; assistant summaries and cumulative totals are not food entries. Reconcile later corrections before import.'];
 let date:string|null=context.defaultDate??null,role='user';const lines=text.split(/\r?\n/),occurrences=new Map<string,number>();
 for(const [i,line] of lines.entries()){
  if(/^\s*(assistant|chatgpt)\s*:/i.test(line)){role='assistant';continue}
  if(/^\s*(user|you)\s*:/i.test(line))role='user';
  if(role==='assistant')continue;const foundDate=line.match(/\b(20\d{2}-\d{2}-\d{2})\b/);if(foundDate&&dateSchema.safeParse(foundDate[1]).success)date=foundDate[1];
  if(!date||/\btotal\b|summary|remaining|actually|correction|no cheese|yesterday/i.test(line))continue;
  const m=line.match(/\b(breakfast|lunch|dinner|snack)\s*(?:was|:|—|-)\s*(.+)/i);if(!m)continue;
  const calories=line.match(/(\d+(?:\.\d+)?)\s*(?:kcal|calories)/i),carbs=line.match(/(\d+(?:\.\d+)?)\s*g\s*(?:carb)/i),title=m[2].split('|')[0].trim().slice(0,300);
  const slot=`${date}:${m[1].toLowerCase()}`,occurrence=(occurrences.get(slot)??0)+1;occurrences.set(slot,occurrence);
  const data:Meal={...emptyMeal,title,mealType:m[1][0].toUpperCase()+m[1].slice(1).toLowerCase(),messageTime:context.messageTime??null,notes:context.messageId?`Conversation message ${context.messageId}; meal occurrence ${occurrence}. Review later corrections.`:`Transcript meal occurrence ${occurrence} for this date and meal type. Review later corrections.`,confidence:calories||carbs?'estimate':'unknown',calories:numeric(calories?.[1]),carbs:numeric(carbs?.[1])};
  const validated=mealSchema.safeParse(data);if(!validated.success){warnings.push(`Line ${i+1} has invalid nutrition values.`);continue}
  candidates.push({key:context.messageId?`${context.messageId}:${m[1].toLowerCase()}:${occurrence}`:`${slot}:occurrence:${occurrence}`,kind:'meal',date,data:validated.data,warning:'Needs review against the original transcript, including later corrections. Unknown nutrients remain unknown.'});
 }
 if(!candidates.length)warnings.push('No unambiguous dated meals found. Use the JSON template or enter meals manually; no intake was inferred.');
 return{candidates,warnings,source:'remy-etl',rawCount:lines.length};
}

/** Existing meals remain authoritative after corrections. Imports never silently
 * overwrite or revive them; differences are returned for explicit review. */
export function reconcileMealImport(existing:{data:Meal;localDate:string|null;deleted?:boolean}|undefined,incoming:Candidate){
 if(!existing)return{action:'insert' as const};
 if(existing.deleted)return{action:'preserve' as const,reason:'This imported meal was deleted. Restore it explicitly from journal history if needed.'};
 const incomingData=incoming.data as Meal;
 const normal=(value:Meal)=>({...value,messageTime:value.messageTime??null});
 if(existing.localDate===incoming.date&&JSON.stringify(normal(existing.data))===JSON.stringify(normal(incomingData)))return{action:'duplicate' as const};
 return{action:'preserve' as const,reason:'An existing meal differs from this source. Your current meal and corrections were preserved; review the incoming values separately.'};
}
