import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertProductionRelease} from '../scripts/verify-production-release.mjs';
test('local and dirty releases cannot overwrite the combined verified application',()=>{
 const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'alimukhamet/antikrizis-assessment-card',GITHUB_WORKFLOW:'Deploy assessment to Cloudflare'};
 assert.doesNotThrow(()=>assertProductionRelease(env,''));
 assert.throws(()=>assertProductionRelease({},''),/Production deploy blocked/);
 assert.throws(()=>assertProductionRelease({...env,GITHUB_REPOSITORY:'other/project'},''),/blocked/);
 assert.throws(()=>assertProductionRelease(env,' M public/questionnaire.html'),/tracked source/);
});
