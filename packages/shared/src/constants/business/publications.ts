import type { ApiComponents } from '../../generated/api';

export type PublicationKind = ApiComponents['schemas']['PublicationKindEnum'];

export const PUBLICATION_ENDPOINTS = {
  BASE: '/api/v1/publications/',
  FILE: (uuid: string) => `/api/v1/publications/${uuid}/file/` as const,
} as const;

export const PUBLICATION_NOTICE = 'publication';

export const PUBLICATION_KIND_LABELS: Record<PublicationKind, string> = {
  holding_statement: 'Annual holding statement',
  meeting_notice: 'Meeting notice',
};

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
  UNDELIVERABLE:
    'This document could not be delivered, because the record of your opening it could not be written. Nothing ' +
    'was served. Try again shortly.',
  FAILED: 'The document could not be opened.',
} as const;
