import test from 'node:test';
import assert from 'node:assert/strict';
import { journalDestination } from '../lib/journal-navigation';
test('legacy journal links retain their destination within two primary views',()=>{
 assert.deepEqual(journalDestination('Food'),{view:'History',utility:null,section:'food'});
 assert.deepEqual(journalDestination('Training'),{view:'History',utility:null,section:'training'});
 assert.deepEqual(journalDestination('Insights'),{view:'History',utility:null,section:'insights'});
 assert.deepEqual(journalDestination('Chat'),{view:'Today',utility:null,section:'coach'});
 for(const utility of ['Connections','Settings'] as const)assert.deepEqual(journalDestination(utility),{view:'Today',utility,section:null});
 for(const unknown of [null,undefined,'','unknown'])assert.equal(journalDestination(unknown).view,'Today');
 assert.deepEqual(journalDestination('History'),{view:'History',utility:null,section:null});
});
