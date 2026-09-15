import { evidenceRepository } from '../../../../../lib/documents/storage';
import { evidenceError } from '../../../../../lib/documents/request-context';
import { handleAssessmentIntakeManifest } from '../../../../../lib/crm/assessment-intake-read';

function environment() {
  return {
    secret: process.env.ASSESSMENT_INTAKE_HMAC_SECRET,
    approvedOrigin: process.env.ASSESSMENT_INTAKE_APPROVED_ORIGIN,
  };
}

export async function POST(request: Request, context: { params: Promise<{ dealId: string }> }) {
  try {
    const { dealId } = await context.params;
    const repository = await evidenceRepository();
    return await handleAssessmentIntakeManifest(request, dealId, { repository, environment: environment() });
  } catch (error) {
    return evidenceError(error);
  }
}
