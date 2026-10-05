import {
  ACKNOWLEDGEABLE_DISCREPANCIES,
  ATTRIBUTION_DISCREPANCIES,
  REGISTER_RECONCILIATION_COPY,
} from '../../../src/constants/business/register-reconciliations';

it('acknowledges the kinds the register API accepts and leaves the rest to attribution', () => {
  expect(ACKNOWLEDGEABLE_DISCREPANCIES).toEqual(['unrecognised_transfer', 'member', 'unlinked', 'supply']);
  expect(ATTRIBUTION_DISCREPANCIES).toEqual(['missing_transfer', 'attribution']);
});

it('describes every discrepancy kind once, each either acknowledgeable or needing attribution', () => {
  expect(Object.keys(REGISTER_RECONCILIATION_COPY.KINDS).sort()).toEqual(
    [...ACKNOWLEDGEABLE_DISCREPANCIES, ...ATTRIBUTION_DISCREPANCIES].sort(),
  );
  expect(ACKNOWLEDGEABLE_DISCREPANCIES.filter((kind) => ATTRIBUTION_DISCREPANCIES.includes(kind))).toEqual([]);
});

it('labels every reconciliation status and who provided an acknowledgement', () => {
  expect(Object.keys(REGISTER_RECONCILIATION_COPY.STATUSES)).toEqual(['matched', 'discrepant', 'failed']);
  expect(Object.keys(REGISTER_RECONCILIATION_COPY.PROVIDED_BY)).toEqual(['company', 'staff']);
});

it('says an acknowledgement explains a divergence and records nothing in the register', () => {
  expect(REGISTER_RECONCILIATION_COPY.ACKNOWLEDGEMENT_NOTE).toMatch(/explains a divergence/);
  expect(REGISTER_RECONCILIATION_COPY.ACKNOWLEDGEMENT_NOTE).toMatch(/records nothing in the register/);
});
