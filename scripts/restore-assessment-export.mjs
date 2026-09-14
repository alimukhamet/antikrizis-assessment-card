import {readFile,writeFile,mkdir,readdir,open,rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {validateAssessmentBundle} from './validate-assessment-export.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const tables={'document':'assessment_documents','extraction':'assessment_extractions','questionnaire-draft':'assessment_draft_versions','review':'assessment_reviews','assessment-submission':'assessment_submissions','document-upload':'assessment_upload_manifests'};
async function regular(path){const h=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{if(!(await h.stat()).isFile())throw Error('RESTORE_NOT_REGULAR_FILE');return await h.readFile();}finally{await h.close();}}
/** Offline isolated destination only. No CRM client or network operation is imported. */
export async function restoreAssessmentExport(exportPath,originals,renderers,destination,credentialOriginals){
 const text=await readFile(exportPath,'utf8'),verified=await validateAssessmentBundle(text,originals),rows=text.trim().split(/\r?\n/).map(JSON.parse);
 const objects=new Map(),rendererFiles=new Map(),credentialFiles=new Map();
 function object(key,bytes){if(typeof key!=='string'||!key)throw Error('RESTORE_INVALID_OBJECT_KEY');const old=objects.get(key);if(old&&!old.equals(bytes))throw Error('RESTORE_OBJECT_KEY_COLLISION');objects.set(key,bytes);}
 for(const row of rows){
  if(row.type==='document'){const bytes=await regular(join(originals,row.original_sha256));if(bytes.length!==row.byte_size||hash(bytes)!==row.original_sha256)throw Error('RESTORE_ORIGINAL_CHANGED');object(row.original_key,bytes);}
  if(row.type==='extraction'){const bytes=Buffer.from(JSON.stringify(row.result));if(hash(bytes)!==row.result_sha256)throw Error('RESTORE_EXTRACTION_ENCODING_MISMATCH');object(row.result_key,bytes);}
  if(row.type==='assessment-submission'){
   const v=row.payload.contractRendererVersion;if(!/^[a-f0-9]{64}$/.test(v))throw Error('RESTORE_RENDERER_VERSION_REQUIRED');
   if(!rendererFiles.has(v))rendererFiles.set(v,await regular(join(renderers,v+'.js')));
  }
 }
 if(credentialOriginals)for(const row of rows.filter(r=>r.type==='document-upload'&&r.manifest.scope==='credentials'&&r.state!=='cancelled')){
  if(row.state!=='verified'||row.receipt?.verified!==true)throw Error('RESTORE_CREDENTIAL_UNVERIFIED');
  for(const file of row.manifest.files){
   if(!row.receipt.files.some(ref=>ref.sha256===file.sha256))throw Error('RESTORE_CREDENTIAL_RECEIPT_MISMATCH');
   const bytes=await regular(join(credentialOriginals,file.sha256));
   if(bytes.length!==file.byteSize||hash(bytes)!==file.sha256)throw Error('RESTORE_CREDENTIAL_HASH_MISMATCH');
   credentialFiles.set(file.sha256,bytes);
  }
 }
 await mkdir(destination,{mode:0o700}); // Must not already exist, even if empty.
 let db;
 try{
  await mkdir(join(destination,'objects'),{mode:0o700});await mkdir(join(destination,'contract-renderers'),{mode:0o700});
  await mkdir(join(destination,'credentials'),{mode:0o700});
  for(const [sha,bytes]of credentialFiles)await writeFile(join(destination,'credentials',sha),bytes,{mode:0o600,flag:'wx'});
  const mapping={};for(const [key,bytes]of objects){const name=hash(Buffer.from(key));await writeFile(join(destination,'objects',name),bytes,{mode:0o600,flag:'wx'});mapping[key]={file:name,sha256:hash(bytes),bytes:bytes.length};}
  for(const [version,bytes]of rendererFiles)await writeFile(join(destination,'contract-renderers',version+'.js'),bytes,{mode:0o600,flag:'wx'});
  const dbPath=join(destination,'assessment.sqlite');await writeFile(dbPath,'',{mode:0o600,flag:'wx'});db=new DatabaseSync(dbPath);db.exec('PRAGMA foreign_keys=ON');
  const migrations=fileURLToPath(new URL('../drizzle/',import.meta.url));for(const name of (await readdir(migrations)).filter(n=>n.endsWith('.sql')).sort())db.exec(await readFile(join(migrations,name),'utf8'));
  db.exec('BEGIN');
  function insert(table,row){const columns=db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name);const fields=columns.filter(k=>Object.hasOwn(row,k));if(row.sequence!==undefined)fields.unshift('rowid');const values=fields.map(k=>k==='rowid'?row.sequence:row[k]);db.prepare(`INSERT INTO ${table} (${fields.map(k=>'"'+k+'"').join(',')}) VALUES (${fields.map(()=>'?').join(',')})`).run(...values);}
  insert('assessment_cases',rows[0].case);
  for(const [type,table]of Object.entries(tables))for(const source of rows.filter(r=>r.type===type)){
   const row={...source};if(Object.hasOwn(row,'payload'))row.payload_json=JSON.stringify(row.payload);
   if(type==='document-upload'){row.manifest_json=JSON.stringify(row.manifest);row.receipt_json=row.receipt?JSON.stringify(row.receipt):null;}
   insert(table,row);
  }
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('RESTORE_FOREIGN_KEYS');db.exec('COMMIT');db.close();db=null;
  await writeFile(join(destination,'object-map.json'),JSON.stringify(mapping,null,2),{mode:0o600});
  await writeFile(join(destination,'questionnaire-definition.json'),JSON.stringify(rows[0].questionnaireDefinition),{mode:0o600});
  const result={...verified,restored:true,objects:objects.size,renderers:rendererFiles.size,externalWritesReplayed:false,credentialOriginalsIncluded:!!credentialOriginals,credentialFilesChecked:credentialFiles.size,sourceExportSha256:hash(Buffer.from(text))};
  await writeFile(join(destination,'complete.json'),JSON.stringify(result,null,2),{mode:0o600,flag:'wx'});return result;
 }catch(error){db?.close();await rm(destination,{recursive:true,force:true});throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{if(![6,7].includes(process.argv.length))throw Error('USAGE: node restore-assessment-export.mjs export.ndjson originals renderers NEW-destination [credential-originals]');console.log(JSON.stringify(await restoreAssessmentExport(...process.argv.slice(2).map(p=>resolve(p))),null,2));}catch(error){console.error(error.message);process.exitCode=1;}}
