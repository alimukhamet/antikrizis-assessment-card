import { evidenceRepository } from '../../../../../../../lib/documents/storage';
import { evidenceError } from '../../../../../../../lib/documents/request-context';
import { handleAssessmentIntakeDocument } from '../../../../../../../lib/crm/assessment-intake-read';

function environment() {
  return {
    secret: process.env.ASSESSMENT_INTAKE_HMAC_SECRET,
    approvedOrigin: process.env.ASSESSMENT_INTAKE_APPROVED_ORIGIN,
  };
}

export async function GET(request: Request, context: { params: Promise<{ dealId: string; documentId: string }> }) {
  try {
    const { dealId, documentId } = await context.params;
    const repository = await evidenceRepository();
    return await handleAssessmentIntakeDocument(request, dealId, documentId, { repository, environment: environment() });
  } catch (error) {
    return evidenceError(error);
  }
}
