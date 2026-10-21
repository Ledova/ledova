import { getChainConfig, shareCount, useOpenRows, useShareHoldings } from '@ledova/shared';
import { Disclosure, Section, LoadError, Loading } from '@components/Ledger';
import { Page } from '@components/Page';
import { HoldingWork } from './HoldingWork';

export default function HomePage() {
  const { data: holdings = [], isPending, isError, isFetching, refetch } = useShareHoldings();
  const rows = useOpenRows();

  return (
    <Page narrow lede="Wallet holdings. Company-recorded shares are shown in Your shares.">
      <Section title="Shares in your wallets">
        {isPending ? (
          <Loading>Loading your holdings…</Loading>
        ) : isError ? (
          <LoadError retry={refetch} busy={isFetching}>
            Your holdings could not be loaded.
          </LoadError>
        ) : holdings.length === 0 ? (
          <p className="py-3 text-sm text-text-muted">
            No wallet shares yet. See Your shares for company-recorded ownership.
          </p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {holdings.map((holding) => (
              <li key={holding.assetUuid}>
                <Disclosure
                  open={rows.isOpen(holding.assetUuid)}
                  onToggle={() => rows.toggle(holding.assetUuid)}
                  summary={
                    <span className="flex flex-wrap items-start justify-between gap-3">
                      <span className="min-w-0 flex-1 basis-40 break-words">
                        {holding.companyName && (
                          <span className="block text-sm text-text-muted">{holding.companyName}</span>
                        )}
                        <span className="block text-base text-text-primary">{holding.name}</span>
                      </span>
                      <span className="ml-auto break-all text-right text-sm tabular-nums text-text-primary">
                        {shareCount(holding.quantity)}
                      </span>
                    </span>
                  }
                >
                  <div className="flex flex-col gap-4">
                    {holding.chains.map((chain) => (
                      <div key={chain.chain}>
                        <p className="flex flex-wrap justify-between gap-2 text-sm text-text-muted">
                          <span>{getChainConfig(chain.chain)?.name ?? chain.chain}</span>
                          <span className="tabular-nums">{shareCount(chain.quantity)}</span>
                        </p>
                        <dl className="mt-2 divide-y divide-border-subtle">
                          {chain.wallets.map((wallet) => (
                            <div key={wallet.uuid} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                              <dt className="min-w-0 break-all text-text-muted">{wallet.name || wallet.address}</dt>
                              <dd className="ml-auto text-right tabular-nums text-text-primary">
                                {shareCount(wallet.quantity)}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    ))}
                  </div>
                </Disclosure>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <HoldingWork />
    </Page>
  );
}
