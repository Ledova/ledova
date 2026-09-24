import type { ApiComponents } from '../../generated/api';
import type { Publication, PublicationCount, PublicationResult, ResolutionStatus } from '../../types';

export type PublicationKind = ApiComponents['schemas']['PublicationKindEnum'];

export type BallotChoice = ApiComponents['schemas']['BallotChoiceEnum'];

export type ResolutionKind = ApiComponents['schemas']['ResolutionKindEnum'];

export const PUBLICATION_ENDPOINTS = {
  BASE: '/api/v1/publications/',
  FILE: (uuid: string) => `/api/v1/publications/${uuid}/file/` as const,
  BALLOT: (uuid: string) => `/api/v1/publications/${uuid}/ballot/` as const,
} as const;

export const PUBLICATION_NOTICE = 'publication';

const PUBLICATION_EXTENSIONS: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
};

export const publicationFilename = (uuid: string, mimeType: string) =>
  `${uuid}${PUBLICATION_EXTENSIONS[(mimeType.split(';')[0] ?? '').trim()] ?? ''}`;

export const PUBLICATION_KIND_LABELS: Record<PublicationKind, string> = {
  holding_statement: 'Annual holding statement',
  meeting_notice: 'Meeting notice',
  resolution: 'Resolution',
  distribution: 'Dividend',
};

export const RESOLUTION_KIND_LABELS: Record<ResolutionKind, string> = {
  ordinary: 'Ordinary resolution',
  special: 'Special resolution',
};

export const BALLOT_CHOICES: readonly BallotChoice[] = ['for', 'against', 'abstain'];

export const PUBLICATION_COPY = {
  LIST_TITLE: 'Published to you',
  EMPTY_TITLE: 'Nothing has been published to you yet',
  EMPTY_BODY:
    'A company publishes to the members of a share class on a record date. When it does, the document and the ' +
    'holding it was addressed to appear here, and they stay here for seven years.',
  HOLDING_LABEL: 'Your holding on the record date',
  RECORD_DATE_LABEL: 'Record date',
  OPEN: 'Open the document',
  OPENING: 'Opening...',
  FROZEN_HELP:
    'The holding shown is the one frozen when the publication was made, not your holding today. The document is ' +
    'the one that was published: it is stored, never regenerated.',
  UNDELIVERABLE: 'This document could not be delivered, and nothing was served. Try again shortly.',
  FAILED: 'The document could not be opened.',
  LIST_FAILED: 'What has been published to you could not be loaded.',
  RETRY: 'Try again',
  LOAD_MORE: 'Show earlier publications',
  LOADING_MORE: 'Loading...',
  QUESTION_LABEL: 'The question put to members',
  WINDOW_LABEL: 'Voting',
  WINDOW_TO: 'to',
  NOT_OPEN_YET: 'Not open yet',
  OPEN_UNTIL: 'Open until',
  CLOSED: 'Closed',
  VOTING_WEIGHT_LABEL: 'Your votes, one for each share you held on the record date',
  BASIS: 'One vote per share',
  CHOICES: { for: 'For', against: 'Against', abstain: 'Abstain' } satisfies Record<BallotChoice, string>,
  CONFIRM_TITLE: 'Cast your ballot:',
  CONFIRM_BODY: 'A ballot cannot be changed or withdrawn once it is cast.',
  CONFIRM: 'Cast my ballot',
  CANCEL: 'Cancel',
  CASTING: 'Casting...',
  YOU_VOTED: {
    for: 'You voted for',
    against: 'You voted against',
    abstain: 'You voted to abstain',
  } satisfies Record<BallotChoice, string>,
  STAFF_ENTERED: 'Voted for you by staff',
  BALLOT_OUTSTANDING: 'Part of your holding has no ballot yet. A ballot cast now counts for that part.',
  BALLOT_FAILED: 'Your ballot could not be recorded.',
  RESULT_LABEL: 'Result',
  RESULT_PENDING: 'Voting has closed. The result appears here once it is counted.',
  CARRIED: 'Carried',
  NOT_CARRIED: 'Not carried',
  TURNOUT_LABEL: 'Turnout',
  RATE_LABEL: 'Declared rate',
  PER_SHARE: 'per share',
  PAYMENT_DATE_LABEL: 'Payment date',
  ENTITLEMENT_LABEL: 'Your entitlement',
  ENTITLEMENT_HELP: 'Your holding on the record date times the declared rate, rounded down to the cent.',
  RECORDED_AS_PAID: 'The company recorded this as paid on',
  REFERENCE: 'reference',
  NO_PAYMENT_RECORDED: 'No payment has been recorded yet.',
  NOTHING_PAYABLE: 'At this rate your holding comes to less than a cent, so there is nothing to pay.',
  RECORDS_ONLY:
    'Ledova shows what the company has recorded. It does not move the money and cannot see the transfer itself.',
} as const;

export function resolutionStatus(
  publication: Pick<Publication, 'opensAt' | 'closesAt' | 'result'>,
  now: Date,
): ResolutionStatus | null {
  if (!publication.opensAt || !publication.closesAt) return null;
  if (publication.result || now.getTime() >= new Date(publication.closesAt).getTime()) return 'closed';
  return now.getTime() < new Date(publication.opensAt).getTime() ? 'upcoming' : 'open';
}

export const LONGEST_TIMER_DELAY = 2 ** 31 - 1;

export function nextResolutionBoundary(
  publication: Pick<Publication, 'opensAt' | 'closesAt' | 'result'>,
  now: Date,
): number | null {
  if (!publication.opensAt || !publication.closesAt || publication.result) return null;
  const opens = new Date(publication.opensAt).getTime();
  if (now.getTime() < opens) return opens;
  const closes = new Date(publication.closesAt).getTime();
  return now.getTime() < closes ? closes : null;
}

export const formatShareCount = (shares: string) => shares.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const memberCount = (members: number) => `${members.toLocaleString('en-AU')} ${members === 1 ? 'member' : 'members'}`;

export const describeCount = (count: PublicationCount) =>
  `${formatShareCount(count.shares)} shares · ${memberCount(count.members)}`;

export function describeTurnout(result: PublicationResult): string {
  const counted = BALLOT_CHOICES.map((choice) => result[choice]);
  const shares = counted.reduce((sum, count) => sum + BigInt(count.shares), 0n).toString();
  const members = counted.reduce((sum, count) => sum + count.members, 0);
  return (
    `${formatShareCount(shares)} of ${formatShareCount(result.eligible.shares)} shares · ` +
    `${members.toLocaleString('en-AU')} of ${memberCount(result.eligible.members)}`
  );
}
