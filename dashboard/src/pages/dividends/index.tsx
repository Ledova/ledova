import { CoinsIcon } from '@phosphor-icons/react';
import { Page } from '@components/Page';
import { Panel } from '@components/Panel';
import { PUBLICATION_COPY, formatDate, formatShareCount, useDividends } from '@ledova/shared';
import type { Publication } from '@ledova/shared';
import { Distribution } from '../publications/Distribution';

function DividendRow({ dividend }: { dividend: Publication }) {
  return (
    <div className="px-4 py-4 border-b border-border-subtle/40 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-primary">{dividend.title}</p>
          <p className="text-xs text-text-muted mt-0.5">
            {dividend.companyName} · {dividend.tokenName}{' '}
            <span className="text-text-subtle">({dividend.tokenSymbol})</span>
          </p>
          <p className="text-xs text-text-muted mt-0.5">
            {PUBLICATION_COPY.RECORD_DATE_LABEL} {formatDate(dividend.recordDate)}
          </p>
        </div>
        {dividend.shares !== null && dividend.shares !== undefined && (
          <div className="text-right">
            <p className="text-sm font-mono text-text-primary">{formatShareCount(dividend.shares)}</p>
            <p className="text-xs text-text-muted">{PUBLICATION_COPY.HOLDING_LABEL}</p>
          </div>
        )}
      </div>
      <Distribution publication={dividend} />
    </div>
  );
}

export default function DividendsPage() {
  const { dividends, isLoading, listFailed, retry, hasMore, isLoadingMore, loadMore } = useDividends();

  if (isLoading) {
    return <Page loading />;
  }

  return (
    <Page>
      <Panel>
        <p className="text-xs text-text-muted pb-3">{PUBLICATION_COPY.DIVIDENDS_APART}</p>
        {listFailed ? (
          <div role="alert" className="px-4 py-12 text-center">
            <p className="text-text-primary mb-4">{PUBLICATION_COPY.DIVIDENDS_LIST_FAILED}</p>
            <button
              type="button"
              onClick={retry}
              className="rounded-lg bg-brand-mid hover:bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors"
            >
              {PUBLICATION_COPY.RETRY}
            </button>
          </div>
        ) : dividends.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <CoinsIcon size={48} className="text-text-muted mx-auto mb-4" weight="duotone" />
            <h3 className="text-lg font-semibold text-text-primary mb-2">{PUBLICATION_COPY.DIVIDENDS_EMPTY_TITLE}</h3>
            <p className="text-text-muted max-w-xl mx-auto">{PUBLICATION_COPY.DIVIDENDS_EMPTY_BODY}</p>
          </div>
        ) : (
          <>
            <div className="-mx-4">
              {dividends.map((dividend) => (
                <DividendRow key={dividend.uuid} dividend={dividend} />
              ))}
            </div>
            {hasMore && (
              <div className="px-4 pt-4 text-center">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={isLoadingMore}
                  className="text-sm text-brand-mid hover:text-brand-light transition-colors disabled:opacity-50"
                >
                  {isLoadingMore ? PUBLICATION_COPY.LOADING_MORE : PUBLICATION_COPY.DIVIDENDS_LOAD_MORE}
                </button>
              </div>
            )}
          </>
        )}
      </Panel>
    </Page>
  );
}
