import type { ApiComponents } from '../../generated/api';

export type HolderType = ApiComponents['schemas']['HolderTypeEnum'];

export const HOLDER_TYPE_LABELS: Record<HolderType, string> = {
  member: 'Member',
  treasury: 'Treasury',
  ambiguous: 'Ambiguous',
  unidentified: 'Unidentified',
};

export const REGISTER_MEMBER_DOCUMENT_CATEGORIES: Record<
  ApiComponents['schemas']['RegisterMemberDocumentCategoryEnum'],
  string
> = {
  share_certificate: 'Share certificate',
  shareholder_agreement: 'Shareholder agreement',
  subscription_agreement: 'Subscription agreement',
  other: 'Other supporting document',
};

export const TECHNICAL_SHARE_LIMIT = (2n ** 256n - 1n).toString();

export const REGISTER_COPY = {
  QUANTITY_GUARD: 'Internal quantity guard',
  NOT_OPENED_NOTE:
    'The register for this share class has not been opened yet, so no members are listed. An applied register ' +
    'opening or register import starts it.',
  WAITING_NOTE: (count: number) =>
    `${count} completed ${count === 1 ? 'issue or transfer waits' : 'issues or transfers wait'} to be recorded, ` +
    'so these holdings leave them out. Recording stops at the first one that cannot be recorded yet, and every ' +
    'later one waits behind it.',
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
  AMBIGUOUS_NOTE: "This member's wallets point to more than one person, so no name is shown.",
  UNIDENTIFIED_NOTE:
    'No linked wallet resolves to a named person through its retained whitelist entry. Ask the participant to ' +
    'add their full name in Profile.',
} as const;
