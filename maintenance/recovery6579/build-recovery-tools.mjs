import {build} from 'esbuild';
await build({stdin:{contents:"export {validateDraft} from './lib/questionnaire/draft.ts'; export {readPdf} from './lib/documents/read-pdf.ts'; export {extractNative} from './lib/documents/extract-native.ts';",resolveDir:process.cwd(),sourcefile:'recovery-tools.ts',loader:'ts'},
 outfile:'maintenance/recovery6579/.recovery-tools.mjs',bundle:true,platform:'node',format:'esm',packages:'external'});
