import { ArrowSquareOutIcon } from '@phosphor-icons/react';
import { PUBLICATION_COPY, PUBLICATION_KIND_LABELS, formatDate, formatShareCount } from '@ledova/shared';
import type { BallotChoice, Publication } from '@ledova/shared';
import { Page, PageAction } from '@components/Page';
import { Row, Rows, Section } from '@components/Ledger';
import { Distribution } from './Distribution';
import { Resolution } from './Resolution';
import { usePublications } from './usePublications';

function PublicationRow({
  publication,
  onOpen,
  isOpening,
  onCast,
  isCasting,
  castError,
}: {
  publication: Publication;
  onOpen: (uuid: string) => void;
  isOpening: boolean;
  onCast: (uuid: string, choice: BallotChoice) => void;
  isCasting: boolean;
  castError: string | undefined;
}) {
  return (
    <article className="min-w-0 break-words">
      <Section title={publication.title}>
        <div className="flex flex-wrap items-start justify-between gap-4 py-2">
          <div className="min-w-0 flex-1 basis-48">
            <p className="text-xs uppercase tracking-wide text-text-muted">
              {PUBLICATION_KIND_LABELS[publication.kind]}
            </p>
            <p className="mt-1 text-sm text-text-primary">{publication.companyName}</p>
            <p className="text-sm text-text-muted">
              {publication.tokenName} ({publication.tokenSymbol})
            </p>
          </div>
          <PageAction
            icon={<ArrowSquareOutIcon size={16} />}
            label={isOpening ? PUBLICATION_COPY.OPENING : PUBLICATION_COPY.OPEN}
            onClick={() => onOpen(publication.uuid)}
            disabled={isOpening}
          />
        </div>
        <Rows>
          <Row label={PUBLICATION_COPY.RECORD_DATE_LABEL}>{formatDate(publication.recordDate)}</Row>
        </Rows>
        {publication.shares !== null && publication.shares !== undefined && (
          <div className="py-2">
            <p className="text-sm text-text-muted">
              {publication.kind === 'resolution'
                ? PUBLICATION_COPY.VOTING_WEIGHT_LABEL
                : PUBLICATION_COPY.HOLDING_LABEL}
            </p>
            <p className="break-all text-lg tabular-nums text-text-primary">{formatShareCount(publication.shares)}</p>
          </div>
        )}
        <Resolution publication={publication} onCast={onCast} isCasting={isCasting} castError={castError} />
        <Distribution publication={publication} />
      </Section>
    </article>
  );
}

export default function PublicationsPage() {
  const {
    publications,
    isLoading,
    listFailed,
    moreFailed,
    isRefreshing,
    retry,
    hasMore,
    isLoadingMore,
    loadMore,
    open,
    openingUuid,
    openError,
    cast,
    castingUuid,
    castError,
  } = usePublications();

  if (isLoading) return <Page loading />;

  return (
    <Page>
      <p className="text-sm text-text-muted">Documents, votes and dividends addressed to you.</p>
      {openError && (
        <p role="alert" className="text-sm text-error-light">
          {openError}
        </p>
      )}
      {listFailed ? (
        <div role="alert" className="flex flex-col items-start gap-3 py-6">
          <p className="text-sm text-text-primary">
            {publications.length
              ? 'Your notices could not be refreshed. Try again before continuing.'
              : PUBLICATION_COPY.LIST_FAILED}
          </p>
          <PageAction label={PUBLICATION_COPY.RETRY} onClick={retry} disabled={isRefreshing} />
        </div>
      ) : (
        <>
          {publications.length === 0 && !hasMore && !moreFailed ? (
            <Section title={PUBLICATION_COPY.EMPTY_TITLE}>
              <p className="py-3 text-sm text-text-muted">{PUBLICATION_COPY.EMPTY_BODY}</p>
            </Section>
          ) : (
            publications.map((publication) => (
              <PublicationRow
                key={publication.uuid}
                publication={publication}
                onOpen={open}
                isOpening={openingUuid === publication.uuid}
                onCast={cast}
                isCasting={castingUuid === publication.uuid}
                castError={castError?.uuid === publication.uuid ? castError.message : undefined}
              />
            ))
          )}
          {moreFailed ? (
            <div role="alert" className="flex flex-col items-start gap-3 py-3">
              <p className="text-sm text-text-primary">Earlier notices could not be loaded. The list is incomplete.</p>
              <PageAction label="Try earlier notices again" onClick={loadMore} disabled={isLoadingMore} />
            </div>
          ) : (
            hasMore && (
              <div className="flex justify-start py-3">
                <PageAction
                  label={isLoadingMore ? PUBLICATION_COPY.LOADING_MORE : PUBLICATION_COPY.LOAD_MORE}
                  onClick={loadMore}
                  disabled={isLoadingMore}
                />
              </div>
            )
          )}
          {publications.length > 0 && <p className="text-xs text-text-muted">{PUBLICATION_COPY.FROZEN_HELP}</p>}
        </>
      )}
    </Page>
  );
}
