import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedJournalDate, journalDestination } from '../lib/journal-navigation';
test('legacy journal links retain their destination within two primary views',()=>{
 assert.deepEqual(journalDestination('Food'),{view:'History',utility:null,section:'food'});
 assert.deepEqual(journalDestination('Training'),{view:'History',utility:null,section:'training'});
 assert.deepEqual(journalDestination('Insights'),{view:'History',utility:null,section:'insights'});
 assert.deepEqual(journalDestination('Chat'),{view:'Today',utility:null,section:'coach'});
 for(const utility of ['Connections','Settings'] as const)assert.deepEqual(journalDestination(utility),{view:'Today',utility,section:null});
 for(const unknown of [null,undefined,'','unknown'])assert.equal(journalDestination(unknown).view,'Today');
 assert.deepEqual(journalDestination('History'),{view:'History',utility:null,section:null});
});

test('future navigation and invalid dates clamp to today in the profile timezone',()=>{
 const now=new Date('2026-11-03T17:00:00Z');
 for(const candidate of ['2026-11-04','2099-01-01','2026-02-30','bad',null])assert.equal(boundedJournalDate(candidate,'America/New_York',now),'2026-11-03');
 assert.equal(boundedJournalDate('2026-11-03','America/New_York',now),'2026-11-03');
 assert.equal(boundedJournalDate('2026-10-31','America/New_York',now),'2026-10-31');
 assert.equal(boundedJournalDate('2026-11-03','America/New_York',new Date('2026-11-03T02:00:00Z')),'2026-11-02');
});
