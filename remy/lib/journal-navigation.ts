import { localDate } from './domain';
export function boundedJournalDate(value: string | null | undefined, timezone = 'America/New_York', now = new Date()) {
  const today = localDate(now, timezone);
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return today;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isFinite(+parsed) || parsed.toISOString().slice(0,10) !== value || value > today ? today : value;
}
export type JournalView = 'Today' | 'History';
export type JournalUtility = 'Connections' | 'Settings' | null;
export function journalDestination(value: string | null | undefined): {
  view: JournalView; utility: JournalUtility; section: 'food' | 'training' | 'insights' | 'coach' | null;
} {
  if(value==='Connections'||value==='Settings')return{view:'Today',utility:value,section:null};
  if(value==='Food')return{view:'History',utility:null,section:'food'};
  if(value==='Training')return{view:'History',utility:null,section:'training'};
  if(value==='Insights')return{view:'History',utility:null,section:'insights'};
  if(value==='Chat')return{view:'Today',utility:null,section:'coach'};
  return{view:value==='History'?'History':'Today',utility:null,section:null};
}
