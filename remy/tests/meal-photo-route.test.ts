import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { assertMealPhotoPath } from '../lib/meal-photo';

const owner = '10000000-0000-4000-8000-000000000000';
const other = '20000000-0000-4000-8000-000000000000';
const path = `${owner}/1/meal-photos/10000000-0000-4000-8000-000000000001-0.jpg`;
const compiled = ts.transpileModule(readFileSync(new URL('../app/api/meal-photo/route.ts', import.meta.url), 'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function harness(options: {unauthorized?: boolean; missing?: boolean; deleted?: boolean; wrongKind?: boolean; foreignPath?: boolean; oldGeneration?: boolean; deletedDuringRead?: boolean; resetDuringRead?: boolean} = {}) {
  const events: string[] = []; let downloaded = false;
  const dependencies: Record<string, unknown> = {
    '@/lib/meal-photo': {assertMealPhotoPath},
    '@/lib/http': {
      authorize: async () => { events.push('auth'); if(options.unauthorized) throw Object.assign(new Error('Sign in'), {status:401}); return {userId:owner}; },
      failure: (error: Error & {status?:number}) => Response.json({error:error.message},{status:error.status??400}),
    },
    '@/lib/store': {
      operationGuard: async (user:string) => { assert.equal(user,owner); return {generation:options.oldGeneration||downloaded&&options.resetDuringRead?2:1}; },
      getEntry: async (user:string,id:string) => { assert.equal(user,owner); assert.equal(id,'meal:1'); return options.missing?null:{id,kind:options.wrongKind?'message':'meal',deleted:options.deleted||downloaded&&options.deletedDuringRead,data:{photoId:options.foreignPath?path.replace(owner,other):path}}; },
      readMealPhoto: async (user:string,photoPath:string) => { assert.equal(user,owner);assert.equal(photoPath,path); events.push('download');downloaded=true;return new Blob(['synthetic photo'],{type:'image/jpeg'}); },
    },
  };
  const exported: {GET?: (request:Request)=>Promise<Response>} = {};
  runInNewContext(compiled,{exports:exported,require:(name:string)=>dependencies[name],Response,Request,URL,Promise});
  return {events,call:()=>exported.GET!(new Request('https://remy.example.invalid/api/meal-photo?id=meal%3A1'))};
}
test('meal photos require authentication and a live owner-scoped meal before storage access', async () => {
  const unauthorized=harness({unauthorized:true});assert.equal((await unauthorized.call()).status,401);assert.deepEqual(unauthorized.events,['auth']);
  for(const option of [{missing:true},{deleted:true},{wrongKind:true},{foreignPath:true},{oldGeneration:true}]){
    const h=harness(option);assert.notEqual((await h.call()).status,200);assert.ok(!h.events.includes('download'));
  }
});
test('private photo response has no cache and rechecks deletion and journal reset after download',async()=>{
  const h=harness(),response=await h.call();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('content-type'),'image/jpeg');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  for(const option of [{deletedDuringRead:true},{resetDuringRead:true}])assert.equal((await harness(option).call()).status,404);
});
test('photo paths cannot cross owners or use traversal, URLs, import files or unsupported suffixes',()=>{
  assert.equal(assertMealPhotoPath(owner,path),path);
  for(const invalid of [path.replace(owner,other),`../${path}`,`https://example.invalid/${path}`,`${owner}/1/imports/file`,path.replace('.jpg','.svg')])assert.throws(()=>assertMealPhotoPath(owner,invalid));
});
