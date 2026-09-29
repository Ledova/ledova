import { CaretRightIcon } from '@phosphor-icons/react';
import { formatShareCount, getChainConfig, useShareHoldings } from '@ledova/shared';
import { Section } from '@components/Ledger';
import { Page, PageAction } from '@components/Page';
import { HoldingWork } from './components/HoldingWork';

export function HomePage() {
  const { data: holdings = [], isPending, isError, isFetching, refetch } = useShareHoldings();

  return (
    <Page>
      <Section title="Shares in your wallets">
        {isPending ? (
          <p role="status" className="py-3 text-sm text-text-muted">
            Loading your holdings…
          </p>
        ) : isError ? (
          <div role="alert" className="flex flex-col items-start gap-3 py-3">
            <p className="text-sm text-text-muted">We couldn&apos;t load all your holdings.</p>
            <PageAction label="Try again" onClick={() => void refetch()} disabled={isFetching} />
          </div>
        ) : holdings.length === 0 ? (
          <p className="py-3 text-sm text-text-muted">
            None of your wallets holds shares yet. The company&apos;s register is the record of what you hold; shares
            appear here once they are in one of your wallets.
          </p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {holdings.map((holding) => (
              <li key={holding.assetUuid}>
                <details className="group">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-2 py-4 marker:hidden">
                    <CaretRightIcon aria-hidden="true" className="shrink-0 text-text-muted group-open:rotate-90" />
                    <span className="min-w-0 flex-1 basis-40 break-words">
                      {holding.companyName && (
                        <span className="block text-sm text-text-muted">{holding.companyName}</span>
                      )}
                      <span className="block text-base text-text-primary">{holding.name}</span>
                    </span>
                    <span className="ml-auto break-all text-right text-sm tabular-nums text-text-primary">
                      {formatShareCount(holding.quantity)} {holding.quantity === '1' ? 'share' : 'shares'}
                    </span>
                  </summary>
                  <div className="flex flex-col gap-4 pb-5 pl-8">
                    {holding.chains.map((chain) => (
                      <div key={chain.chain}>
                        <p className="flex flex-wrap justify-between gap-2 text-sm text-text-muted">
                          <span>{getChainConfig(chain.chain)?.name ?? chain.chain}</span>
                          <span className="tabular-nums">
                            {formatShareCount(chain.quantity)} {chain.quantity === '1' ? 'share' : 'shares'}
                          </span>
                        </p>
                        <dl className="mt-2 divide-y divide-border-subtle">
                          {chain.wallets.map((wallet) => (
                            <div key={wallet.uuid} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                              <dt className="min-w-0 break-all text-text-muted">{wallet.name || wallet.address}</dt>
                              <dd className="ml-auto text-right tabular-nums text-text-primary">
                                {formatShareCount(wallet.quantity)} {wallet.quantity === '1' ? 'share' : 'shares'}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    ))}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <HoldingWork />
    </Page>
  );
}

export default HomePage;
