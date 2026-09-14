// Local-only config: select supported public options, not internal fields in Vite's generated output.
import fs from 'node:fs/promises';import path from 'node:path';
const root=process.cwd(),built=JSON.parse(await fs.readFile('dist/server/wrangler.json','utf8'));
const config=Object.fromEntries(['name','compatibility_date','compatibility_flags','d1_databases','r2_buckets','rules'].map(k=>[k,built[k]]));
Object.assign(config,{main:path.join(root,'dist/server/index.js'),no_bundle:true,assets:{directory:path.join(root,'dist/client'),binding:'ASSETS'},dev:{ip:'127.0.0.1'}});
if(process.argv.includes('--synthetic-test'))config.vars={AUTH_PROVIDER:'local',SITE_ACCESS_PASSWORD:'local-test-password',SITE_SESSION_TOKEN:'local-test-session-key-not-used-in-production',BITRIX_WEBHOOK:'http://127.0.0.1:4191/'};
await fs.mkdir('.wrangler',{recursive:true});await fs.writeFile('.wrangler/local-runtime.json',JSON.stringify(config));console.log('Local runtime config prepared; production config unchanged.');
