import { ArrowSquareOutIcon, EnvelopeSimpleIcon, NewspaperIcon } from '@phosphor-icons/react';
import { Panel } from '@components/Panel';
import { PUBLICATION_COPY, PUBLICATION_KIND_LABELS, formatDate } from '@ledova/shared';
import type { Publication } from '@ledova/shared';
import { usePublications } from './usePublications';

function PageWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-4xl mx-auto px-4 pt-6 pb-16 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 sm:gap-5 md:gap-6">{children}</div>
    </div>
  );
}

function PublicationRow({
  publication,
  onOpen,
  isOpening,
}: {
  publication: Publication;
  onOpen: (uuid: string) => void;
  isOpening: boolean;
}) {
  return (
    <div className="px-4 py-4 border-b border-border-subtle/40 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-text-muted">{PUBLICATION_KIND_LABELS[publication.kind]}</p>
          <p className="text-sm font-semibold text-text-primary mt-0.5">{publication.title}</p>
          <p className="text-xs text-text-muted mt-0.5">
            {publication.companyName} · {publication.tokenName}{' '}
            <span className="text-text-subtle">({publication.tokenSymbol})</span>
          </p>
          <p className="text-xs text-text-muted mt-0.5">
            {PUBLICATION_COPY.RECORD_DATE_LABEL} {formatDate(publication.recordDate)}
          </p>
        </div>
        <div className="text-right">
          {publication.shares !== null && publication.shares !== undefined && (
            <>
              <p className="text-sm font-mono text-text-primary">{Number(publication.shares).toLocaleString()}</p>
              <p className="text-xs text-text-muted">{PUBLICATION_COPY.HOLDING_LABEL}</p>
            </>
          )}
          <button
            type="button"
            onClick={() => onOpen(publication.uuid)}
            disabled={isOpening}
            className="mt-2 inline-flex items-center gap-2 rounded-lg bg-brand-mid hover:bg-brand disabled:opacity-50 px-4 py-2 text-sm font-semibold text-white transition-colors"
          >
            <ArrowSquareOutIcon size={16} />
            {isOpening ? PUBLICATION_COPY.OPENING : PUBLICATION_COPY.OPEN}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PublicationsPage() {
  const { publications, isLoading, open, openingUuid, openError } = usePublications();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 border-4 border-brand-subtle border-t-brand rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <PageWrapper>
      <Panel title={PUBLICATION_COPY.LIST_TITLE} icon={<NewspaperIcon size={20} />}>
        {openError && (
          <div role="alert" className="mx-4 mb-3 rounded-lg bg-error/10 px-4 py-3 text-sm text-error">
            {openError}
          </div>
        )}
        {publications.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <EnvelopeSimpleIcon size={48} className="text-text-muted mx-auto mb-4" weight="duotone" />
            <h3 className="text-lg font-semibold text-text-primary mb-2">{PUBLICATION_COPY.EMPTY_TITLE}</h3>
            <p className="text-text-muted max-w-xl mx-auto">{PUBLICATION_COPY.EMPTY_BODY}</p>
          </div>
        ) : (
          <>
            <div className="-mx-4">
              {publications.map((publication) => (
                <PublicationRow
                  key={publication.uuid}
                  publication={publication}
                  onOpen={open}
                  isOpening={openingUuid === publication.uuid}
                />
              ))}
            </div>
            <p className="px-4 pt-4 text-xs text-text-muted">{PUBLICATION_COPY.FROZEN_HELP}</p>
          </>
        )}
      </Panel>
    </PageWrapper>
  );
}
