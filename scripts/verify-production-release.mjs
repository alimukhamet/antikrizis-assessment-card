// Production has one release path. Direct publication from old local checkouts
// previously replaced newer intake features while updating the earnings page.
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
export function assertProductionRelease(env,dirty){
 if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!=='alimukhamet/antikrizis-assessment-card'||!['Deploy assessment to Cloudflare','Assessment checks'].includes(env.GITHUB_WORKFLOW))throw Error('Production deploy blocked: commit changes and push deploy/anti-krizis. The verified GitHub workflow publishes the combined application; local checkouts must not replace production.');
 if(dirty.trim())throw Error('Production deploy blocked: tracked source changed after checkout. Commit the generated assets with their source.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const dirty=execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'});
 assertProductionRelease(process.env,dirty);
}
