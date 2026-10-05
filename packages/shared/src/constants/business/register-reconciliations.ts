import type { RegisterReconciliationStatus } from '../../types';

export const ACKNOWLEDGEABLE_DISCREPANCIES: readonly string[] = [
  'unrecognised_transfer',
  'member',
  'unlinked',
  'supply',
];

export const ATTRIBUTION_DISCREPANCIES: readonly string[] = ['missing_transfer', 'attribution'];

export const REGISTER_RECONCILIATION_COPY = {
  TITLE: 'Reconciliation with the chain',
  EMPTY:
    'No reconciliation has been recorded for this share class. A class with an applied register opening is ' +
    'reconciled with the chain every six hours; a class an import opened is not on chain and is not reconciled.',
  STATUSES: {
    matched: 'Matched',
    discrepant: 'Discrepant',
    failed: 'Failed',
  } as Record<RegisterReconciliationStatus, string>,
  FAILED_NOTE: 'The chain could not be compared with the stored register.',
  KINDS: {
    unrecognised_transfer:
      'A chain transfer after the opening that no recorded, waiting or executing platform operation accounts for, ' +
      'such as a direct transfer between whitelisted wallets.',
    missing_transfer:
      'A completed effect whose transaction is not on chain in its block. Treat it as a reorganisation and do not ' +
      'rely on the register until it is attributed.',
    member:
      "A member's linked wallets hold a different number of shares from the stored register plus pending movements " +
      'and earlier acknowledgements.',
    unlinked:
      'An address linked to no member holds a different number of shares from what pending movements and earlier ' +
      'acknowledgements give it.',
    supply:
      'The issued supply on chain differs from the stored supply plus pending issues and earlier acknowledgements.',
    attribution: 'A completion the evidence cannot place against the opening of the register.',
  } as Record<string, string>,
  FIELDS: {
    transaction: 'Transaction',
    block: 'Block',
    member: 'Member',
    address: 'Address',
    chain: 'On chain',
    expected: 'Expected',
    effect: 'Effect',
    source: 'Source',
    detail: 'Detail',
  },
  ACKNOWLEDGEABLE_NOTE: 'Acknowledge it once the company has investigated its cause and accepted it.',
  ATTRIBUTION_NOTE: 'It cannot be acknowledged. It needs attribution, which Ledova does not provide yet.',
  ACKNOWLEDGEMENT_NOTE:
    'An acknowledgement explains a divergence the company has investigated and accepted. It records nothing in the ' +
    'register, whose holdings stay as recorded, and later reconciliations treat the row as explained.',
  READ_ONLY_NOTE:
    'You can read these reconciliations. Acknowledging a discrepancy needs an appointment with administration or ' +
    'approval.',
  PROVIDED_BY: {
    company: 'Acknowledged by the company',
    staff: 'Acknowledged by Ledova staff before acknowledgement was company-run',
  } as Record<string, string>,
  ACKNOWLEDGE: 'Acknowledge',
  ACKNOWLEDGE_REASON: 'Reason for acknowledging',
  UNREADABLE: 'The reconciliation could not be read.',
  ACKNOWLEDGEMENT_RECEIPT_FAILED: 'The acknowledgement could not be confirmed. Refresh before retrying.',
  ACKNOWLEDGE_FAILED: 'The acknowledgement was not recorded. Retry the same acknowledgement after refreshing.',
};
