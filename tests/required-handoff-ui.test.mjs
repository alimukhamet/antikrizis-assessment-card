import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {JSDOM} from 'jsdom';
test('lawyer handoff distinguishes a skipped answer from an explicit no and preserves an existing note',t=>{
 const dom=new JSDOM(fs.readFileSync('public/questionnaire.html','utf8'),{runScripts:'outside-only'}),w=dom.window,d=w.document;t.after(()=>w.close());
 w.visibilityRules=()=>{};let refreshes=0;w.AssessmentWorkflow={refresh(){refreshes++;}};w.eval(fs.readFileSync('public/lawyer-notes.js','utf8'));
 const choice=d.getElementById('lawyerNotesStatus'),note=d.getElementById('comment'),details=d.getElementById('lawyerNotesDetails');
 assert.equal(choice.required,true);assert.equal(choice.value,'');assert.equal(choice.checkValidity(),false);assert.equal(details.classList.contains('hidden'),true);
 choice.value='yes';choice.dispatchEvent(new w.Event('change'));assert.equal(details.classList.contains('hidden'),false);assert.equal(note.checkValidity(),false);
 note.value='SYNTHETIC HANDOFF';choice.value='no';choice.dispatchEvent(new w.Event('change'));assert.equal(details.classList.contains('hidden'),true);assert.equal(note.value,'SYNTHETIC HANDOFF');
 choice.value='';d.dispatchEvent(new w.Event('assessment-draft-restored'));assert.equal(choice.value,'yes');assert.equal(details.classList.contains('hidden'),false);assert.ok(refreshes>=4);
 choice.value='';note.value='';d.dispatchEvent(new w.Event('assessment-draft-restored'));assert.equal(choice.value,'','blank old drafts never become an automatic no');
 assert.equal(d.getElementById('gamblingTransfers').required,true);assert.equal(d.getElementById('gamblingTransfers').hasAttribute('data-optional'),false);
});
