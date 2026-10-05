import {
  REGISTER_CORRECTION_COPY,
  REGISTER_CORRECTION_UNMET_COPY,
} from '../../../src/constants/business/register-corrections';

const CORRECTION_REQUIREMENTS = [
  'appointment_capability_required',
  'correction_decided',
  'reason_required',
  'reason_not_allowed',
  'company_provided_evidence_required',
  'already_approved',
  'approval_required',
  'approval_lapsed',
  'evidence_unavailable',
  'register_changed',
  'entry_already_corrected',
  'position_would_go_negative',
];

it('words every requirement a correction decision can leave unmet, and nothing else', () => {
  expect(Object.keys(REGISTER_CORRECTION_UNMET_COPY).sort()).toEqual([...CORRECTION_REQUIREMENTS].sort());
  expect(Object.values(REGISTER_CORRECTION_UNMET_COPY).filter((sentence) => !sentence.trim())).toEqual([]);
});

it('labels every register entry kind, correction stage, decision and authority', () => {
  expect(Object.keys(REGISTER_CORRECTION_COPY.ENTRY_KINDS)).toEqual([
    'opening',
    'issue',
    'transfer',
    'cessation',
    'correction',
  ]);
  expect(Object.keys(REGISTER_CORRECTION_COPY.STAGES)).toEqual(['submitted', 'approved', 'applied', 'rejected']);
  expect(Object.keys(REGISTER_CORRECTION_COPY.DECISIONS)).toEqual(['approve', 'apply', 'reject']);
  expect(Object.keys(REGISTER_CORRECTION_COPY.CONFIRMATIONS)).toEqual(['approve', 'apply', 'reject']);
  expect(Object.keys(REGISTER_CORRECTION_COPY.AUTHORITIES)).toEqual(['director_resolution', 'court_order']);
});

it('names the authority document as provided by the company, not verified by Ledova', () => {
  expect(REGISTER_CORRECTION_COPY.AUTHORITY_DOCUMENT_NOTE).toMatch(/provided by the company/);
  expect(REGISTER_CORRECTION_COPY.AUTHORITY_DOCUMENT_NOTE).toMatch(/does not verify/);
});

it('sends an unconfirmed preparation to the corrections on Register, not to a reload that would drop the draft', () => {
  expect(REGISTER_CORRECTION_COPY.PREPARATION_RECEIPT_FAILED).toMatch(/Check the corrections on Register/);
  expect(REGISTER_CORRECTION_COPY.PREPARATION_RECEIPT_FAILED).not.toMatch(/refresh|reload/i);
});
