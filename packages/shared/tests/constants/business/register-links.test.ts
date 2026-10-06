import { REGISTER_CORRECTION_COPY } from '../../../src/constants/business/register-corrections';
import { REGISTER_IMPORT_COPY } from '../../../src/constants/business/register-imports';
import { REGISTER_LINK_COPY, REGISTER_LINK_UNMET_COPY } from '../../../src/constants/business/register-links';
import { REGISTER_OPENING_COPY } from '../../../src/constants/business/register-openings';

const LINK_REQUIREMENTS = [
  'appointment_capability_required',
  'link_decided',
  'reason_required',
  'reason_not_allowed',
  'company_provided_evidence_required',
  'already_approved',
  'approval_required',
  'approval_lapsed',
  'evidence_unavailable',
  'wallet_linked_elsewhere',
];

it('words every requirement a wallet link decision can leave unmet, and nothing else', () => {
  expect(Object.keys(REGISTER_LINK_UNMET_COPY).sort()).toEqual([...LINK_REQUIREMENTS].sort());
  expect(Object.values(REGISTER_LINK_UNMET_COPY).filter((sentence) => !sentence.trim())).toEqual([]);
});

it('labels every wallet link stage, decision, confirmation, authority and wallet proof', () => {
  expect(Object.keys(REGISTER_LINK_COPY.STAGES)).toEqual(['submitted', 'approved', 'applied', 'rejected']);
  expect(Object.keys(REGISTER_LINK_COPY.DECISIONS)).toEqual(['approve', 'apply', 'reject']);
  expect(Object.keys(REGISTER_LINK_COPY.CONFIRMATIONS)).toEqual(['approve', 'apply', 'reject']);
  expect(Object.keys(REGISTER_LINK_COPY.AUTHORITIES)).toEqual(['director_resolution', 'court_order']);
  expect(Object.keys(REGISTER_LINK_COPY.WALLET_PROOF)).toEqual(['proven', 'not_proven']);
});

it('labels who provided a wallet link as every other register family does', () => {
  for (const copy of [REGISTER_IMPORT_COPY, REGISTER_CORRECTION_COPY, REGISTER_OPENING_COPY])
    expect(REGISTER_LINK_COPY.PROVIDED_BY_COMPANY).toBe(copy.PROVIDED_BY_COMPANY);
  expect(REGISTER_LINK_COPY.STAFF_VERIFIED).toBe(
    REGISTER_OPENING_COPY.STAFF_VERIFIED.replace('openings', 'wallet links'),
  );
  expect(REGISTER_LINK_COPY.AUTHORITY_DOCUMENT_NOTE).toMatch(/provided by the company/);
  expect(REGISTER_LINK_COPY.AUTHORITY_DOCUMENT_NOTE).toMatch(/does not verify/);
});

it("states a wallet's proof as the holder's own, and says verified only of a staff-era link", () => {
  expect(REGISTER_LINK_COPY.WALLET_PROOF.proven).toBe('The holder proved control of this wallet on Ledova');
  expect(REGISTER_LINK_COPY.WALLET_PROOF.not_proven).toMatch(/^The holder has not proved control of this wallet/);
  const sentences = Object.values({
    ...REGISTER_LINK_COPY,
    WAITING: REGISTER_LINK_COPY.WAITING(2),
    HOLDING: REGISTER_LINK_COPY.HOLDING('2', 'ORD'),
  }).flatMap((value) => (typeof value === 'string' ? [value] : Object.values(value)));
  expect(sentences.filter((sentence) => /verified/i.test(sentence))).toEqual([REGISTER_LINK_COPY.STAFF_VERIFIED]);
});

it('says the statuses choose nothing, and why a wallet shows none', () => {
  expect(REGISTER_LINK_COPY.STATUS_NOTE).toMatch(/needs neither/);
  expect(REGISTER_LINK_COPY.STATUS_NOTE).toMatch(/the company chooses each member itself/);
  expect(REGISTER_LINK_COPY.NO_STATUS).toMatch(/not on the company's whitelist/);
});

it('counts the issues and transfers waiting for a wallet in words', () => {
  expect(REGISTER_LINK_COPY.WAITING(1)).toBe('1 completed issue or transfer waits for this wallet to be linked');
  expect(REGISTER_LINK_COPY.WAITING(3)).toBe('3 completed issues or transfers wait for this wallet to be linked');
});

it('sends an unconfirmed preparation to the wallet links on Register, not to a reload that would drop the draft', () => {
  expect(REGISTER_LINK_COPY.PREPARATION_RECEIPT_FAILED).toMatch(/Check the wallet links on Register/);
  expect(REGISTER_LINK_COPY.PREPARATION_RECEIPT_FAILED).not.toMatch(/refresh|reload/i);
});
