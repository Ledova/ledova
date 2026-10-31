import type {
  CertifierBody,
  InvestorCategory,
  InvestorClassification,
  InvestorClassificationSubmission,
  UploadFile,
} from '../types';
import { addCalendarDays, addCalendarYears, isCalendarDate, utcToday } from './date';

interface InvestorClaimDraft {
  category: InvestorCategory | null;
  declaredBasis: string;
  certificateIssuedAt: string;
  certifierName: string;
  certifierBody: CertifierBody | '';
  certifierMembershipNumber: string;
  declarationAccepted: boolean;
}

export function investorClaimChecks(draft: InvestorClaimDraft, hasFile: boolean, today = utcToday()) {
  const needsCertifier = draft.category === 'accountant_certificate';
  const earliestCertificate = addCalendarYears(addCalendarDays(today, 1), -2);
  return {
    needsCertifier,
    today,
    earliestCertificate,
    problems: {
      certificateIssuedAt:
        needsCertifier &&
        (!isCalendarDate(draft.certificateIssuedAt) ||
          draft.certificateIssuedAt < earliestCertificate ||
          draft.certificateIssuedAt > today) &&
        'Enter a certificate date within the last two years, no later than today (UTC).',
      certifierBody: needsCertifier && !draft.certifierBody && 'Choose the professional body.',
      certifierName: needsCertifier && !draft.certifierName.trim() && 'Give the accountant’s name.',
      certifierMembershipNumber:
        needsCertifier && !draft.certifierMembershipNumber.trim() && 'Give the membership number.',
      declaredBasis: !draft.declaredBasis.trim() && 'Give the basis for the claim.',
      file: !hasFile && 'Choose the evidence file.',
      declaration: !draft.declarationAccepted && 'Accept the declaration.',
    },
  };
}

export function investorClaimSubmission(
  draft: InvestorClaimDraft & { category: InvestorCategory },
  file: UploadFile,
): InvestorClassificationSubmission {
  const certifier = draft.category === 'accountant_certificate';
  return {
    category: draft.category,
    declaredBasis: draft.declaredBasis.trim(),
    file,
    certificateIssuedAt: certifier ? draft.certificateIssuedAt : undefined,
    certifierName: certifier ? draft.certifierName.trim() : undefined,
    certifierBody: certifier && draft.certifierBody ? draft.certifierBody : undefined,
    certifierMembershipNumber: certifier ? draft.certifierMembershipNumber.trim() : undefined,
  };
}

export function investorClaimState(claim: InvestorClassification): { label: string; tone: 'moving' | 'closed' } {
  const tone = claim.status === 'submitted' ? 'moving' : 'closed';
  if (claim.status === 'submitted') return { label: 'Available to share', tone };
  if (claim.status === 'verified')
    return { label: claim.isExpired ? 'Historical verification expired' : 'Historical verification', tone };
  return { label: claim.statusDisplay, tone };
}
