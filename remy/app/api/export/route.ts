import {authorize,failure} from '@/lib/http';
import {exportJournal} from '@/lib/store';
export const runtime='nodejs';
export async function GET(request:Request){try{const user=await authorize(request),journal=await exportJournal(user.userId);return new Response(JSON.stringify(journal,null,2),{headers:{'Content-Type':'application/json','Content-Disposition':'attachment; filename="remy-journal.json"','Cache-Control':'no-store'}})}catch(e){return failure(e)}}
