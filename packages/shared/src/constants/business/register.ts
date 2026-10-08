import type { ApiComponents } from '../../generated/api';

export type HolderType = ApiComponents['schemas']['HolderTypeEnum'];

export const HOLDER_TYPE_LABELS: Record<HolderType, string> = {
  member: 'Member',
  treasury: 'Treasury',
  ambiguous: 'Ambiguous',
  unidentified: 'Unidentified',
};

export const REGISTER_COPY = {
  DOWNLOAD: 'Download CSV',
  DOWNLOAD_FAILED: 'The register could not be downloaded. Try again.',
  PRIVACY_NOTE:
    'Names, holder types and holdings are shown here. Residential addresses are in the CSV only, and every ' +
    'download is logged.',
  NOT_OPENED_NOTE:
    'The register for this share class has not been opened yet, so no members are listed and the CSV cannot be ' +
    'downloaded. An applied register opening or register import starts it.',
  WAITING_NOTE: (count: number) =>
    `${count} completed ${count === 1 ? 'issue or transfer waits' : 'issues or transfers wait'} to be recorded, ` +
    'so these holdings leave them out. Recording stops at the first one that cannot be recorded yet, such as one ' +
    'whose wallet is not yet linked to a member, and every later one waits behind it.',
  WAITING_UNKNOWN_NOTE:
    'Whether any completed issue or transfer waits to be recorded could not be checked. Try again before relying ' +
    'on these holdings.',
  NO_REGISTER:
    'There is no company register to show. Share classes appear here for companies you own or where your company ' +
    'appointment includes register access.',
  FORMER_TITLE: 'Former-member history',
  FORMER_NOTE:
    'Each row retains the particulars and holding when membership ceased. A return keeps the same member ID and its recorded return date.',
  NO_WALLET: 'No linked wallet',
  AMBIGUOUS_NOTE:
    "This member's wallets point to more than one person, so no name is shown. Resolve the wallet records before " +
    'relying on the register.',
  UNIDENTIFIED_NOTE:
    'No linked wallet resolves to a person through its retained whitelist entry. Ask the participant to verify ' +
    'and nominate the linked wallet for company approval.',
  APPLICATIONS_TITLE: 'Applications',
  APPLICATIONS_EMPTY: 'No one has applied to this offering yet.',
  APPLICATIONS_NOTE: (operator: string) =>
    `Read-only. Payment recording is done by ${operator}. Company paid issue authority is managed on the share class; this ledger shows the recorded financial outcome.`,
} as const;
