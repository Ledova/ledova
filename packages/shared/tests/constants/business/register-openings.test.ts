import { REGISTER_OPENING_COPY, REGISTER_OPENING_UNMET_COPY } from '../../../src/constants/business/register-openings';

const OPENING_REQUIREMENTS = [
  'appointment_capability_required',
  'opening_decided',
  'reason_required',
  'reason_not_allowed',
  'company_provided_evidence_required',
  'already_approved',
  'approval_required',
  'approval_lapsed',
  'evidence_unavailable',
  'boundary_changed',
  'register_initialized',
  'completions_not_represented',
  'wallet_linked_elsewhere',
];

it('words every requirement an opening decision can leave unmet, and nothing else', () => {
  expect(Object.keys(REGISTER_OPENING_UNMET_COPY).sort()).toEqual([...OPENING_REQUIREMENTS].sort());
  expect(Object.values(REGISTER_OPENING_UNMET_COPY).filter((sentence) => !sentence.trim())).toEqual([]);
});

it('labels every opening stage, decision and authority', () => {
  expect(Object.keys(REGISTER_OPENING_COPY.STAGES)).toEqual(['submitted', 'approved', 'applied', 'rejected']);
  expect(Object.keys(REGISTER_OPENING_COPY.DECISIONS)).toEqual(['approve', 'apply', 'reject']);
  expect(Object.keys(REGISTER_OPENING_COPY.CONFIRMATIONS)).toEqual(['approve', 'apply', 'reject']);
  expect(Object.keys(REGISTER_OPENING_COPY.AUTHORITIES)).toEqual(['director_resolution', 'court_order']);
});

it('says the boundary is captured at preparation and checked again before approval and application', () => {
  expect(REGISTER_OPENING_COPY.BOUNDARY_NOTE).toMatch(/captured when the opening is prepared/);
  expect(REGISTER_OPENING_COPY.BOUNDARY_NOTE).toMatch(/before the opening is approved and before it is applied/);
});

it('says the opening records the holdings at the boundary block', () => {
  expect(REGISTER_OPENING_COPY.HOLDINGS_NOTE).toMatch(/records the holdings at that block/);
});

it('names the authority document as provided by the company, not verified by Ledova', () => {
  expect(REGISTER_OPENING_COPY.AUTHORITY_DOCUMENT_NOTE).toMatch(/provided by the company/);
  expect(REGISTER_OPENING_COPY.AUTHORITY_DOCUMENT_NOTE).toMatch(/does not verify/);
});

it("says when the chain can't be read now, and when the holdings moved and must be read again", () => {
  expect(REGISTER_OPENING_COPY.HOLDERS_UNAVAILABLE).toMatch(/chain can't be read now/);
  expect(REGISTER_OPENING_COPY.HOLDINGS_MOVED).toMatch(/changed after they were read/);
  expect(REGISTER_OPENING_COPY.HOLDINGS_MOVED).toMatch(/Reload the holdings/);
});

it('tells new members on one page apart by number', () => {
  expect(REGISTER_OPENING_COPY.NEW_MEMBER_NUMBERED(2)).toMatch(new RegExp(`^${REGISTER_OPENING_COPY.NEW_MEMBER} 2$`));
});

it('names the boundary block by its number and date', () => {
  expect(REGISTER_OPENING_COPY.BOUNDARY_BLOCK(12, '2026-09-20')).toMatch(/\b12\b.*\b2026-09-20$/);
});

it('sends an unconfirmed preparation to the openings on Register, not to a reload that would drop the draft', () => {
  expect(REGISTER_OPENING_COPY.PREPARATION_RECEIPT_FAILED).toMatch(/Check the openings on Register/);
  expect(REGISTER_OPENING_COPY.PREPARATION_RECEIPT_FAILED).not.toMatch(/refresh|reload/i);
});
