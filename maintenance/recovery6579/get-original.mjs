import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {SOURCE} from './recover6579-core.mjs';
// Arguments are passed without a shell; remote R2 GET only, never put/delete.
await promisify(execFile)('npx',['--no-install','wrangler','r2','object','get',SOURCE.bucket+'/'+SOURCE.key,'--remote','--file','recovery6579-original.bin'],{timeout:120000,maxBuffer:1048576});
console.log('Pinned original downloaded; byte verification runs before parsing.');
