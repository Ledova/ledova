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
  NO_WALLET: 'No linked wallet',
  AMBIGUOUS_NOTE:
    "This member's wallets point to more than one person, so no name is shown. Resolve the wallet records before " +
    'relying on the register.',
  UNIDENTIFIED_NOTE:
    'No wallet linked to this member resolves to a person through its whitelist entry. Ask the operator to add one.',
  APPLICATIONS_TITLE: 'Applications',
  APPLICATIONS_EMPTY: 'No one has applied to this offering yet.',
  APPLICATIONS_NOTE: (operator: string) =>
    `Read-only. Payment confirmation and allotment are done by ${operator}; this is where you watch them happen.`,
} as const;
