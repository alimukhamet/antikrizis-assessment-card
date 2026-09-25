import {buildKnowledgeData} from '../../../lib/knowledge/source';
export const dynamic = 'force-dynamic';
export async function GET() {
  return Response.json(buildKnowledgeData(), {headers: {'cache-control': 'private, no-store'}});
}
