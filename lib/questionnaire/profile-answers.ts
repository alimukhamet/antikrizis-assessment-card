import {RepositoryError} from '../documents/repository';
import type {DraftPayload} from './draft';

/**
 * Profile-only completeness gate.
 *
 * This is deliberately separate from `checkAnswers`: the contract download keeps
 * its own required set (contract number, amount, payment terms, documents, ...)
 * unchanged. The save-without-contract action only requires the profile facts the
 * owner asked sales to collect — the two addresses, the enforcement decision and,
 * when enforcement exists, its structured numbers — plus the client identity.
 *
 * Where the owner's sources do not define a rule, none is invented here; the
 * remaining card answers are carried as-is in the signed envelope.
 */
export type ProfileIssue = {key: string; label: string; code: string};

export class ProfileNotReadyError extends RepositoryError {
  constructor(public readonly issues: ProfileIssue[]) {
    super('PROFILE_NOT_READY', 400);
  }
}

const ADDRESS_REQUIRED = 'PROFILE_ADDRESS_REQUIRED';
const ENFORCEMENT_DECISION_REQUIRED = 'PROFILE_ENFORCEMENT_DECISION_REQUIRED';
const ENFORCEMENT_ROW_REQUIRED = 'PROFILE_ENFORCEMENT_ROW_REQUIRED';
const ENFORCEMENT_FIELD_REQUIRED = 'PROFILE_ENFORCEMENT_FIELD_REQUIRED';
const ENFORCEMENT_AMOUNT_INVALID = 'PROFILE_ENFORCEMENT_AMOUNT_INVALID';
const IDENTITY_REQUIRED = 'PROFILE_IDENTITY_REQUIRED';
const WRONG_CLIENT = 'WRONG_CLIENT';
const DEAL_IDENTITY_UNVERIFIED = 'DEAL_IDENTITY_UNVERIFIED';

function clean(value: string | undefined): string {
  return (value ?? '').trim();
}

function isAmount(value: string): boolean {
  return /^\d+(?:\.\d{1,2})?$/.test(value) && Number.isFinite(Number(value)) && Number(value) <= Number.MAX_SAFE_INTEGER / 100;
}

export type ProfileAnswersResult = {
  ready: boolean;
  issues: ProfileIssue[];
  addresses: {registration: string; actual: string};
  enforcementStatus: string;
  enforcementRowCount: number;
};

export function checkProfileAnswers(payload: DraftPayload, trustedIin: string | null): ProfileAnswersResult {
  const issues: ProfileIssue[] = [];
  const answers = new Map(payload.answers.map(answer => [answer.key, answer]));
  const value = (key: string) => clean(answers.get(key)?.value);
  const selected = (key: string) => answers.get(key)?.checked === true;

  if (!trustedIin) {
    issues.push({key: 'iin', label: 'Сначала подтвердите клиента сделки', code: DEAL_IDENTITY_UNVERIFIED});
  } else {
    const iin = value('iin');
    if (!iin) issues.push({key: 'iin', label: 'ИИН клиента', code: IDENTITY_REQUIRED});
    else if (iin !== trustedIin) issues.push({key: 'iin', label: 'ИИН клиента', code: WRONG_CLIENT});
  }
  if (!value('fio')) issues.push({key: 'fio', label: 'ФИО клиента', code: IDENTITY_REQUIRED});

  const registration = value('addressRegistration');
  if (!registration) issues.push({key: 'addressRegistration', label: 'Адрес регистрации (прописка)', code: ADDRESS_REQUIRED});
  const actual = value('addressActual') || (selected('addressActualSame') ? registration : '');
  if (!actual) issues.push({key: 'addressActual', label: 'Фактический адрес проживания', code: ADDRESS_REQUIRED});

  const enforcementStatus = value('enforcementStatus');
  if (!enforcementStatus) {
    issues.push({key: 'enforcementStatus', label: 'Есть исполнительные производства или исполнительные надписи?', code: ENFORCEMENT_DECISION_REQUIRED});
  }

  let enforcementRowCount = 0;
  if (enforcementStatus === 'yes') {
    const rows = (payload.groups.find(group => group.id === 'enforcements')?.rows ?? [])
      .filter(row => row.some(answer => clean(answer.value) || answer.checked));
    enforcementRowCount = rows.length;
    if (!rows.length) {
      issues.push({key: 'enforcements', label: 'Добавьте хотя бы одно исполнительное производство', code: ENFORCEMENT_ROW_REQUIRED});
    }
    for (const [index, row] of rows.entries()) {
      const rowValue = (key: string) => clean(row.find(answer => answer.key === key)?.value);
      if (!rowValue('enforcementCreditor')) {
        issues.push({key: 'enforcementCreditor', label: `Взыскатель / кредитор (производство ${index + 1})`, code: ENFORCEMENT_FIELD_REQUIRED});
      }
      const amount = rowValue('enforcementAmount');
      if (!amount) {
        issues.push({key: 'enforcementAmount', label: `Сумма взыскания, ₸ (производство ${index + 1})`, code: ENFORCEMENT_FIELD_REQUIRED});
      } else if (!isAmount(amount)) {
        issues.push({key: 'enforcementAmount', label: `Сумма взыскания, ₸ (производство ${index + 1})`, code: ENFORCEMENT_AMOUNT_INVALID});
      }
    }
  }

  return {
    ready: issues.length === 0,
    issues,
    addresses: {registration, actual},
    enforcementStatus,
    enforcementRowCount,
  };
}
