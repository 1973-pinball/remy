import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as domain from '../lib/domain';
import * as validation from '../lib/validation';
import * as imports from '../lib/imports';
const code=ts.transpileModule(fs.readFileSync(new URL('../app/api/import/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
type Guard={generation:number;provider?:string;version?:number};
function harness(deleteDuringBody=false){
 let generation=1;const guards:Guard[]=[],writes:string[]=[];
 const checked=(guard:Guard)=>{assert.ok(guard,'Every import mutation needs a guard');guards.push(guard);if(guard.generation!==generation)throw new Error('Journal changed during import');};
 const http={authorize:async()=>({userId:'synthetic-owner'}),body:async(request:Request)=>{const result=await request.json();if(deleteDuringBody)generation++;return result},json:(value:unknown)=>Response.json(value),failure:(error:Error)=>Response.json({error:error.message},{status:400})};
 const store={operationGuard:async(_owner:string,provider?:string)=>({generation,...provider?{provider,version:2}:{}}),listEntries:async()=>[],hash:async(text:string)=>Buffer.from(text).toString('base64url'),uploadOriginal:async(_owner:string,_path:string,_text:string,guard:Guard)=>{checked(guard);writes.push('original')},saveEntry:async(_owner:string,input:Record<string,unknown>)=>{checked(input.guard as Guard);writes.push(String(input.kind));return{entry:{...input,revision:1,updatedAt:'2026-04-04T12:00:00Z'},duplicate:false}}};
 const connections={persistWorkout:async(_owner:string,_source:string,_id:string,_data:unknown,_raw:unknown,_zone:string,guard:Guard)=>{checked(guard);writes.push('workout');return{entry:{},duplicate:false,matched:false,updated:false}}};
 const modules:Record<string,unknown>={'@/lib/http':http,'@/lib/store':store,'@/lib/connections':connections,'@/lib/domain':domain,'@/lib/validation':validation,'@/lib/imports':imports},module:{exports:Record<string,unknown>}={exports:{}};
 new Function('require','module','exports',code)((name:string)=>{if(!(name in modules))throw new Error('Unexpected route dependency '+name);return modules[name]},module,module.exports);
 const post=module.exports.POST as(request:Request)=>Promise<Response>;
 return{guards,writes,send:(source:string,candidates:unknown[])=>post(new Request('http://localhost/api/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'commit',reviewed:true,source,original:'synthetic original',candidates})}))};
}
const meal=imports.importMeals(JSON.stringify([{id:'synthetic-1',date:'2026-04-04',title:'Synthetic meal',calories:500}])).candidates[0];
test('meal import threads one original-generation/source guard through storage and audit',async()=>{
 const h=harness(),response=await h.send('remy-etl',[meal]);assert.equal(response.status,200);assert.deepEqual(h.writes,['original','meal','import']);assert.ok(h.guards.every(guard=>guard.generation===1&&guard.provider==='remy-etl'&&guard.version===2));
});
test('workout import forwards its operation guard to reconciliation',async()=>{
 const h=harness(),data={title:'Synthetic run',start:'2026-04-04T12:00:00Z',durationSec:3600,distanceMeters:10000,calories:null,avgHr:null,elevationMeters:null,sport:'running',notes:''};const response=await h.send('strava',[{kind:'workout',key:'1',date:'2026-04-04',data}]);assert.equal(response.status,200);assert.deepEqual(h.writes,['original','workout','import']);assert.ok(h.guards.every(guard=>guard.provider==='strava'));
});
test('deletion during request parsing cannot give an old import a new generation',async()=>{
 const h=harness(true),response=await h.send('remy-etl',[meal]);assert.equal(response.status,400);assert.deepEqual(h.writes,[]);assert.equal(h.guards[0].generation,1);
});
