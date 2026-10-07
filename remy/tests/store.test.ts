import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const cwd=fileURLToPath(new URL('../',import.meta.url));
function serverTest(code:string){
  // Keep Next's server-only boundary enabled and isolate process env/fetch mocks.
  const result=spawnSync(process.execPath,['--conditions=react-server','--import','tsx','--input-type=module','-e',code],{cwd,encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stderr||result.stdout||String(result.error));
}
test('revisions from one source and matched sources refresh canonical run metrics without overwriting local corrections',()=>serverTest(`
  import assert from 'node:assert/strict';
  import {reconcileWorkout} from './lib/connections.ts';
  const run={title:'Run',start:'2026-10-06T18:00:00Z',durationSec:3600,distanceMeters:9500,avgHr:145,calories:750,elevationMeters:50,sport:'running',notes:''};
  const base={id:'run',kind:'workout',localDate:'2026-10-06',source:'tredict',sourceId:'t1',revision:1,updatedAt:'2026-10-06T19:00:00Z',data:reconcileWorkout(null,'tredict','t1',run,{version:1})};
  const revised=reconcileWorkout(base,'tredict','t1',{...run,distanceMeters:9700},{version:2});
  assert.equal(revised.distanceMeters,9700);assert.equal(revised.sourceRefs.length,1);
  const merged=reconcileWorkout(base,'strava','s1',{...run,distanceMeters:10000,calories:null},{version:1});
  assert.equal(merged.distanceMeters,10000);assert.equal(merged.calories,750);assert.equal(merged.sourceRefs.length,2);assert.equal(merged.fieldSources.distanceMeters,'strava:s1');
  const again=reconcileWorkout({...base,data:merged},'strava','s1',{...run,distanceMeters:10100,calories:null},{version:2});
  assert.equal(again.distanceMeters,10100);assert.equal(again.sourceRefs.length,2);
  const local=reconcileWorkout({...base,data:{...merged,title:'My corrected title',distanceMeters:9900}},'strava','s1',{...run,distanceMeters:10200,calories:null},{version:3});
  assert.equal(local.distanceMeters,9900);assert.equal(local.title,'My corrected title');assert.equal(local.fieldSources.distanceMeters,'local');
  const legacy=reconcileWorkout({...base,data:run},'tredict','t1',{...run,distanceMeters:9800},{version:2});assert.equal(legacy.distanceMeters,9800);
`));
test('credential storage encrypts values and binds ciphertext to its owner and provider',()=>serverTest(`
  import assert from 'node:assert/strict';
  process.env.NEXT_PUBLIC_SUPABASE_URL='https://unit-test.example.invalid';process.env.SUPABASE_SECRET_KEY='sb_secret_unit_test_only';process.env.SECRET_ENCRYPTION_KEY='unit-test-only-key-with-more-than-32-characters';
  const rows=new Map();
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input));assert.equal(url.host,'unit-test.example.invalid');
    if(url.pathname.endsWith('/rpc/remy_write_secret')){const body=JSON.parse(init.body);rows.set(body.p_owner+':'+body.p_provider,body.p_ciphertext);return Response.json(null);}
    if(url.pathname.endsWith('/remy_secrets')){const owner=url.searchParams.get('owner').slice(3),provider=url.searchParams.get('provider').slice(3),ciphertext=rows.get(owner+':'+provider);return Response.json(ciphertext?[{ciphertext}]:[]);}
    throw new Error('Unexpected request');
  };
  const {writeSecret,readSecret}=await import('./lib/store.ts');
  const owner='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002';
  await writeSecret(owner,'whoop',{access_token:'test-credential-not-real'});
  const encoded=rows.get(owner+':whoop');assert.ok(!encoded.includes('test-credential-not-real'));
  assert.deepEqual(await readSecret(owner,'whoop'),{access_token:'test-credential-not-real'});
  assert.equal(await readSecret(other,'whoop'),null);
  rows.set(other+':whoop',encoded);await assert.rejects(()=>readSecret(other,'whoop'),/cannot be unlocked/);
  rows.set(owner+':strava',encoded);await assert.rejects(()=>readSecret(owner,'strava'),/cannot be unlocked/);
`));
test('journal deletion traverses all private-file pages before deleting database rows',()=>serverTest(`
  import assert from 'node:assert/strict';
  process.env.NEXT_PUBLIC_SUPABASE_URL='https://unit-test.example.invalid';process.env.SUPABASE_SECRET_KEY='sb_secret_unit_test_only';
  const owner='10000000-0000-4000-8000-000000000001',removed=new Set();let finished=false,began=false;
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input));assert.equal(url.host,'unit-test.example.invalid');const body=JSON.parse(init.body||'{}');
    if(url.pathname.endsWith('/rpc/remy_begin_delete')){began=true;return Response.json(null);}
    if(url.pathname.endsWith('/rpc/remy_finish_delete')){assert.equal(removed.size,501);finished=true;return Response.json(null);}
    if(url.pathname.includes('/object/list/')){assert.ok(began);assert.ok(!finished);assert.ok(body.prefix.startsWith(owner));if(body.prefix===owner)return Response.json(body.offset?[]:[{name:'imports',id:null}]);return Response.json(Array.from({length:Math.min(body.limit,501-body.offset)},(_,i)=>({id:String(body.offset+i),name:'file-'+String(body.offset+i).padStart(4,'0')})));}
    if(url.pathname.endsWith('/object/remy-files')&&init.method==='DELETE'){assert.ok(!finished);assert.ok(body.prefixes.length<=100);body.prefixes.forEach(path=>{assert.ok(path.startsWith(owner+'/'));removed.add(path)});return Response.json([]);}
    throw new Error('Unexpected request');
  };
  const {deleteJournal}=await import('./lib/store.ts');
  const result=await deleteJournal(owner);assert.equal(result.filesDeleted,501);assert.ok(finished);
`));
test('feed addresses reject unsafe hosts and OAuth token expiry is normalized',()=>serverTest(`
  import assert from 'node:assert/strict';
  import {validateRunnaUrl,tokenPayload} from './lib/connections.ts';
  assert.equal(validateRunnaUrl('webcal://calendar.runna.com/feed.ics'),'https://calendar.runna.com/feed.ics');
  for(const url of ['https://runna.com.evil.example/feed.ics','https://127.0.0.1/feed.ics','https://u:p@runna.com/feed.ics'])assert.throws(()=>validateRunnaUrl(url));
  assert.equal(tokenPayload({access_token:'test-only',refresh_token:'test-only',expires_at:1800000000},'strava').expiresAt,1800000000000);
  assert.throws(()=>tokenPayload({access_token:'test-only'},'whoop'));
`));

test('a refresh response arriving after disconnect cannot restore encrypted credentials',()=>serverTest(`
  import assert from 'node:assert/strict';
  process.env.NEXT_PUBLIC_SUPABASE_URL='https://unit-test.example.invalid';process.env.SUPABASE_SECRET_KEY='sb_secret_unit_test_only';process.env.SECRET_ENCRYPTION_KEY='unit-test-only-key-with-more-than-32-characters';
  process.env.WHOOP_CLIENT_ID='test';process.env.WHOOP_CLIENT_SECRET='test';
  const owner='10000000-0000-4000-8000-000000000001';let ciphertext=null,version=0,refreshes=0;
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input));
    if(url.host==='api.prod.whoop.com'){
      assert.equal(url.pathname,'/oauth/oauth2/token');refreshes++;version++;ciphertext=null;
      return Response.json({access_token:'new-test-only',refresh_token:'rotated-test-only',expires_in:3600});
    }
    assert.equal(url.host,'unit-test.example.invalid');const body=JSON.parse(init.body||'{}');
    if(url.pathname.endsWith('/rpc/remy_operation_state'))return Response.json({generation:1,provider:body.p_provider,version});
    if(url.pathname.endsWith('/rpc/remy_acquire_lock'))return Response.json(true);
    if(url.pathname.endsWith('/rpc/remy_release_lock'))return Response.json(null);
    if(url.pathname.endsWith('/rpc/remy_write_secret')){
      if(body.p_guard&&body.p_guard.version!==version)return Response.json({message:'REMY_STALE_OPERATION'},{status:400});
      ciphertext=body.p_ciphertext;return Response.json(null);
    }
    if(url.pathname.endsWith('/remy_secrets'))return Response.json(ciphertext?[{ciphertext}]:[]);
    throw new Error('Unexpected request');
  };
  const {writeSecret}=await import('./lib/store.ts');const {providerToken}=await import('./lib/connections.ts');
  await writeSecret(owner,'whoop',{access_token:'expired-test-only',refresh_token:'old-test-only',expiresAt:1});
  await assert.rejects(()=>providerToken(owner,'whoop'),error=>error.staleOperation===true);
  assert.equal(refreshes,1);assert.equal(ciphertext,null);
`));

test('sync status after deletion keeps its original generation and cannot recreate a connection',()=>serverTest(`
  import assert from 'node:assert/strict';
  process.env.NEXT_PUBLIC_SUPABASE_URL='https://unit-test.example.invalid';process.env.SUPABASE_SECRET_KEY='sb_secret_unit_test_only';process.env.SECRET_ENCRYPTION_KEY='unit-test-only-key-with-more-than-32-characters';
  const owner='10000000-0000-4000-8000-000000000001';let ciphertext=null,generation=1,writes=0,rejected=0;
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input));
    if(url.host==='api.prod.whoop.com'){generation=2;ciphertext=null;return Response.json({records:[],next_token:null});}
    assert.equal(url.host,'unit-test.example.invalid');const body=JSON.parse(init.body||'{}');
    if(url.pathname.endsWith('/rpc/remy_operation_state'))return Response.json({generation,provider:body.p_provider,version:0,disabled:false});
    if(url.pathname.endsWith('/rpc/remy_acquire_lock'))return Response.json(true);
    if(url.pathname.endsWith('/rpc/remy_release_lock'))return Response.json(null);
    if(url.pathname.endsWith('/rpc/remy_write_secret')){ciphertext=body.p_ciphertext;return Response.json(null);}
    if(url.pathname.endsWith('/remy_secrets'))return Response.json(ciphertext?[{ciphertext}]:[]);
    if(url.pathname.endsWith('/remy_records'))return Response.json([]);
    if(url.pathname.endsWith('/rpc/remy_save_entry')){
      assert.equal(body.p_guard.generation,1);
      if(body.p_guard.generation!==generation){rejected++;return Response.json({message:'REMY_STALE_OPERATION'},{status:400});}
      writes++;throw new Error('A stale status must never write');
    }
    throw new Error('Unexpected request');
  };
  const {writeSecret}=await import('./lib/store.ts');const {syncSource}=await import('./lib/connections.ts');
  await writeSecret(owner,'whoop',{access_token:'test-only',refresh_token:'test-only',expiresAt:Date.now()+3600000});
  await assert.rejects(()=>syncSource(owner,'whoop'),error=>error.staleOperation===true);
  assert.equal(writes,0);assert.ok(rejected>0);assert.equal(ciphertext,null);
`));
