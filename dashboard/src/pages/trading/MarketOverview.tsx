import { Link } from 'react-router-dom';
import type { ShareToken } from '@ledova/shared';
import { formatShareCount, DIRECTORY_COPY, DESTINATIONS, marketAmount } from '@ledova/shared';
import { Section, Rows, Row } from '@components/Ledger';

interface MarketOverviewProps {
  tokens: ShareToken[];
  selectedTokenUuid: string | null;
  onSelectToken: (uuid: string) => void;
  isLoading: boolean;
  isReady: boolean;
  error?: unknown;
  onRetry?: () => void;
}

export function MarketOverview({
  tokens,
  selectedTokenUuid,
  onSelectToken,
  isLoading,
  isReady,
  error,
  onRetry,
}: MarketOverviewProps) {
  return (
    <Section title="Share classes">
      <p className="text-sm text-text-muted">
        Select a share class to see For sale and Wanted. Orders match automatically. Buyers fund their payment wallet
        before placing an offer.
      </p>
      {error ? (
        <div role="alert">
          Share classes could not be loaded.{' '}
          <button className="underline" onClick={onRetry}>
            Retry share classes
          </button>
        </div>
      ) : isLoading ? (
        <p role="status">Loading share classes…</p>
      ) : tokens.length === 0 ? (
        <div className="space-y-2 text-sm">
          <p>{isReady ? DIRECTORY_COPY.MARKET_EMPTY_TITLE : DIRECTORY_COPY.INELIGIBLE_TITLE}</p>
          <p className="text-text-muted">
            {isReady ? DIRECTORY_COPY.MARKET_EMPTY_BODY : DIRECTORY_COPY.MARKET_INELIGIBLE_BODY}
          </p>
          <Link className="underline" to={DESTINATIONS.eligibilityRequests.path}>
            Eligibility requests
          </Link>
          {!isReady && (
            <Link className="underline" to="/investor-eligibility">
              Check my account
            </Link>
          )}
        </div>
      ) : (
        tokens.map((token) => (
          <div key={token.uuid} className="border-b border-border-subtle py-3 last:border-b-0">
            <button
              className="max-w-full break-all text-left font-medium underline"
              aria-pressed={selectedTokenUuid === token.uuid}
              onClick={() => onSelectToken(token.uuid)}
            >
              {token.companyName || token.name} · {token.symbol}
            </button>
            <Rows>
              <Row label="Last trade">{token.lastPrice ? marketAmount(token.lastPrice) : 'Not recorded'}</Row>
              <Row label="Authorised shares">
                <span className="break-all">{token.totalSupply ? formatShareCount(token.totalSupply) : '0'}</span>
              </Row>
            </Rows>
          </div>
        ))
      )}
    </Section>
  );
}
