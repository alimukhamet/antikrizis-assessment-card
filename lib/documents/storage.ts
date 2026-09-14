import {EvidenceRepository, RepositoryError} from './repository';
export async function evidenceRepository(){
 const {env}=await import('cloudflare:workers');
 const runtime=env as typeof env & {DB?:D1Database;FILES?:R2Bucket};
 if(!runtime.DB||!runtime.FILES)throw new RepositoryError('EVIDENCE_STORAGE_NOT_CONFIGURED',503);
 return new EvidenceRepository(runtime.DB,runtime.FILES);
}
