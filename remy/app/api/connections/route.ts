import {authorize,body,json,failure} from '@/lib/http';
import {appOrigin,config,configuredSources,PROVIDERS,syncSource,tokenPayload,validateRunnaUrl,type Provider} from '@/lib/connections';
import {deleteSecret,disconnectSource,enableSource,operationGuard,type OperationGuard,listEntries,saveEntry,readSecret,writeSecret} from '@/lib/store';
export const runtime='nodejs';
export const maxDuration=60;
async function stravaOAuth(owner:string,request:Request){const c=config();if(!c.STRAVA_CLIENT_ID||!c.STRAVA_CLIENT_SECRET||!c.SECRET_ENCRYPTION_KEY)throw new Error('Configure Strava developer credentials and encrypted server storage first.');const guard=await operationGuard(owner,'strava'),url=new URL(request.url),redirectUri=appOrigin()+'/api/connections?provider=strava';if(url.searchParams.has('error'))throw new Error('Strava authorization was declined. Start the connection again.');const code=url.searchParams.get('code');if(!code){if(url.searchParams.get('action')!=='connect')throw new Error('Choose Connect Strava to start authorization.');const state=crypto.randomUUID();await writeSecret(owner,'strava-state',{state,expiresAt:Date.now()+600000,guard},guard);const target=new URL('https://www.strava.com/oauth/authorize');Object.entries({client_id:c.STRAVA_CLIENT_ID,redirect_uri:redirectUri,response_type:'code',approval_prompt:'auto',scope:'activity:read_all',state}).forEach(([k,v])=>target.searchParams.set(k,v));return Response.redirect(target.href,302);}const saved=await readSecret<{state:string;expiresAt:number;guard:OperationGuard}>(owner,'strava-state');if(!saved?.guard||saved.expiresAt<Date.now()||saved.state!==url.searchParams.get('state'))throw new Error('Strava sign-in expired. Start the connection again.');await deleteSecret(owner,'strava-state',saved.guard);const accepted=(url.searchParams.get('scope')??'').split(/[ ,]+/);if(!accepted.includes('activity:read_all'))throw new Error('Allow read access to all your activities so private runs are included in weekly mileage.');let response:Response;try{response=await fetch('https://www.strava.com/oauth/token',{method:'POST',body:new URLSearchParams({grant_type:'authorization_code',code,client_id:c.STRAVA_CLIENT_ID,client_secret:c.STRAVA_CLIENT_SECRET}),redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw new Error('Strava could not be reached. Start authorization again.');}if(!response.ok)throw new Error('Strava authorization failed. Verify the configured callback domain.');let raw:unknown;try{raw=await response.json();}catch{throw new Error('Strava returned an invalid authorization response.');}await enableSource(owner,'strava',saved.guard);await writeSecret(owner,'strava',{...tokenPayload(raw,'strava'),scope:accepted.join(' ')},saved.guard);await saveEntry(owner,{id:'connection:strava',kind:'connection',localDate:null,guard:saved.guard,data:{provider:'strava',disconnected:false,authorized:true,lastSuccess:null,coverageNote:'Authorized; select Sync now to retrieve actual activity records.'}});return Response.redirect(appOrigin()+'/?view=Connections',302);}
export async function GET(request:Request){try{const user=await authorize(request);if(new URL(request.url).searchParams.get('provider')==='strava')return await stravaOAuth(user.userId,request);return json({...await configuredSources(user.userId),statuses:(await listEntries(user.userId)).filter(e=>e.kind==='connection')});}catch(e){return failure(e);}}
export async function POST(request:Request){
 try{
  const user=await authorize(request,true),journalGuard=await operationGuard(user.userId),b=await body(request);
  if(!PROVIDERS.includes(b.source as Provider))throw new Error('Unknown source.');
  const source=b.source as Provider,current=await operationGuard(user.userId,source),guard={...current,generation:journalGuard.generation,version:journalGuard.versions?.[source]??0};
  if(current.generation!==journalGuard.generation)throw new Error('The journal changed during this request. Refresh before trying again.');
  if(b.action==='disconnect'){await disconnectSource(user.userId,source,guard);return json({disconnected:true});}
  if(b.action==='credential'){
   if(source!=='tredict'&&source!=='runna')throw new Error('Use OAuth to connect this source.');
   const value=String(b.value??'').trim();if(!value||value.length>10000)throw new Error('Enter a valid connection credential.');
   await enableSource(user.userId,source,guard);
   await writeSecret(user.userId,source,{value:source==='runna'?validateRunnaUrl(value):value},guard);
   await saveEntry(user.userId,{id:'connection:'+source,kind:'connection',localDate:null,guard,data:{provider:source,authorized:true,disconnected:false,lastSuccess:null}});
   return json({saved:true});
  }
  if(b.action==='enable'){
   await enableSource(user.userId,source,guard);guard.disabled=false;
   const old=(await listEntries(user.userId)).find(e=>e.id==='connection:'+source);
   await saveEntry(user.userId,{id:'connection:'+source,kind:'connection',localDate:null,guard,data:{...old?.data,provider:source,disconnected:false}});
  }else if(b.action!=='sync')throw new Error('Unknown connection action.');
  return json(await syncSource(user.userId,source,guard));
 }catch(e){return failure(e);}
}
