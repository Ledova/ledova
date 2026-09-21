import type { ApiComponents } from '../../generated/api';

export type HolderType = ApiComponents['schemas']['HolderTypeEnum'];

export const HOLDER_TYPE_LABELS: Record<HolderType, string> = {
  member: 'Member',
  treasury: 'Treasury',
  ambiguous: 'Ambiguous',
  unidentified: 'Unidentified',
};

export const REGISTER_COPY = {
  TITLE: 'Register Of Members',
  DOWNLOAD: 'Download CSV',
  DOWNLOAD_FAILED: 'The register could not be downloaded. Try again.',
  PRIVACY_NOTE:
    'Names, holder types and holdings are shown here. Residential addresses are in the CSV only, and every ' +
    'download is logged.',
  NOT_OPENED_NOTE:
    'The register for this share class has not been opened yet, so no members are listed and the CSV cannot be ' +
    'downloaded. An approved register opening starts it.',
  WAITING_NOTE: (count: number) =>
    `${count} completed ${count === 1 ? 'issue or transfer waits' : 'issues or transfers wait'} to be recorded, ` +
    'so these holdings leave them out. One waits while its wallet has no reviewed link to a member, or while an ' +
    'earlier one waits.',
  WAITING_UNKNOWN_NOTE:
    'Whether any completed issue or transfer waits to be recorded could not be checked. Try again before relying ' +
    'on these holdings.',
  NO_WALLET: 'No linked wallet',
  NOT_OPENED_CLASSES: (symbols: string[]) =>
    `Not opened yet, so their members are not listed: ${symbols.join(', ')}. An approved register opening starts ` +
    'each one.',
  AMBIGUOUS_NOTE:
    "This member's wallets point to more than one person, so no name is shown. Resolve the wallet records before " +
    'relying on the register.',
  UNIDENTIFIED_NOTE:
    'No wallet linked to this member resolves to a person through its whitelist entry. Ask the operator to add one.',
  SUBSCRIPTIONS_TITLE: 'Subscriptions',
  SUBSCRIPTIONS_EMPTY: 'No subscription has been made to this offering yet.',
  SUBSCRIPTIONS_NOTE:
    'Read-only. Payment confirmation and allotment are operator actions; this is where you watch them happen.',
} as const;
