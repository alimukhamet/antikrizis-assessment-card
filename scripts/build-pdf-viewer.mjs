import fs from 'node:fs/promises';
const target='public/pdf-assets';await fs.mkdir(target,{recursive:true});
for(const name of ['pdf.mjs','pdf.worker.mjs'])await fs.copyFile('node_modules/pdfjs-dist/legacy/build/'+name,target+'/'+name);
for(const name of ['cmaps','standard_fonts','wasm'])await fs.cp('node_modules/pdfjs-dist/'+name,target+'/'+name,{recursive:true});
await fs.copyFile('node_modules/pdfjs-dist/LICENSE',target+'/LICENSE');
console.log('Local PDF viewer assets prepared.');
