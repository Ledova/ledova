import { REGISTER_CORRECTION_COPY } from '../../../src/constants/business/register-corrections';
import { REGISTER_IMPORT_COPY } from '../../../src/constants/business/register-imports';
import { REGISTER_OPENING_COPY } from '../../../src/constants/business/register-openings';
import {
  REGISTER_PARTICULARS_COPY,
  REGISTER_PARTICULARS_UNMET_COPY,
} from '../../../src/constants/business/register-particulars';

const PARTICULARS_REQUIREMENTS = [
  'appointment_capability_required',
  'change_decided',
  'reason_required',
  'reason_not_allowed',
  'already_approved',
  'approval_required',
  'approval_lapsed',
  'evidence_unavailable',
  'member_left_retention',
  'newer_particulars_exist',
];

it('words every requirement a particulars decision can leave unmet, and nothing else', () => {
  expect(Object.keys(REGISTER_PARTICULARS_UNMET_COPY).sort()).toEqual([...PARTICULARS_REQUIREMENTS].sort());
  expect(Object.values(REGISTER_PARTICULARS_UNMET_COPY).filter((sentence) => !sentence.trim())).toEqual([]);
});

it('labels every particulars change stage, decision and confirmation', () => {
  expect(Object.keys(REGISTER_PARTICULARS_COPY.STAGES)).toEqual(['submitted', 'approved', 'applied', 'rejected']);
  expect(Object.keys(REGISTER_PARTICULARS_COPY.DECISIONS)).toEqual(['approve', 'apply', 'reject']);
  expect(Object.keys(REGISTER_PARTICULARS_COPY.CONFIRMATIONS)).toEqual(['approve', 'apply', 'reject']);
});

it('labels a change as provided by the company as every other register family does, and its document unverified', () => {
  for (const copy of [REGISTER_IMPORT_COPY, REGISTER_CORRECTION_COPY, REGISTER_OPENING_COPY])
    expect(REGISTER_PARTICULARS_COPY.PROVIDED_BY_COMPANY).toBe(copy.PROVIDED_BY_COMPANY);
  expect(REGISTER_PARTICULARS_COPY.SUPPORTING_DOCUMENT_NOTE).toMatch(/provided by the company/);
  expect(REGISTER_PARTICULARS_COPY.SUPPORTING_DOCUMENT_NOTE).toMatch(/does not verify/);
});

it('says the latest as-at date wins between imports and changes, and live verified identity wins over both', () => {
  expect(REGISTER_PARTICULARS_COPY.PRECEDENCE_NOTE).toMatch(/latest as-at date wins/);
  expect(REGISTER_PARTICULARS_COPY.PRECEDENCE_NOTE).toMatch(/live verified identity still wins over both/);
});

it('sends an unconfirmed preparation to the changes on Register, not to a reload that would drop the draft', () => {
  expect(REGISTER_PARTICULARS_COPY.PREPARATION_RECEIPT_FAILED).toMatch(/Check the particulars changes on Register/);
  expect(REGISTER_PARTICULARS_COPY.PREPARATION_RECEIPT_FAILED).not.toMatch(/refresh|reload/i);
});
