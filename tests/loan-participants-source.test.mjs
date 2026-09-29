import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {participantRoles,parseParticipants,formatParticipants} from '../public/loan-participants.mjs';

test('source participant roles populate the real editor without rewriting the evidence-backed value',()=>{
 const editor=fs.readFileSync('public/loan-participants-editor.mjs','utf8').replace(/^import[^\n]+\n/,'');
 for(const [label,role] of [['Созаемщик (присоединившееся лицо) с солидарными обязательствами','Созаёмщик'],['Созаёмщик (присоединившееся лицо) с солидарными обязательствами','Созаёмщик'],['Кепілдік беруші - O','Гарант'],['Кепілдік беруші - О','Гарант'],['Ынтымақты міндеттемелері бар қосалқы қарыз алушы (қосылған тұлға)','Созаёмщик']]){
  const dom=new JSDOM('<div id="questionnaireStep"><textarea id="loanParticipants"></textarea></div>',{runScripts:'outside-only'});
  try{
   const {window}=dom,input=window.document.querySelector('textarea');
   new window.Function('participantRoles','parseParticipants','formatParticipants',editor)(participantRoles,parseParticipants,formatParticipants);
   const value='ТЕСТОВ ТЕСТ ТЕСТОВИЧ — '+label;input.value=value;input.dispatchEvent(new window.Event('change',{bubbles:true}));
   const shadow=input.nextElementSibling.shadowRoot;
   assert.equal(shadow.querySelector('select').value,'some');assert.equal(shadow.querySelector('.person input').value,'ТЕСТОВ ТЕСТ ТЕСТОВИЧ');assert.equal(shadow.querySelector('.person select').value,role);assert.equal(shadow.querySelector('.legacy').hidden,true);assert.equal(input.validationMessage,'');assert.equal(input.value,value);
  }finally{dom.window.close();}
 }
});
