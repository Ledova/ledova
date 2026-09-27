import { Link } from 'react-router-dom';
import type { ShareToken } from '@ledova/shared';
import { formatShareCount, DIRECTORY_COPY } from '@ledova/shared';
import { Section, Rows, Row } from '@components/Ledger';
import { marketAmount } from '../marketData';

interface MarketOverviewProps {
  tokens: ShareToken[];
  selectedTokenUuid: string | null;
  onSelectToken: (uuid: string) => void;
  isLoading: boolean;
  isEligible: boolean;
  error?: unknown;
  onRetry?: () => void;
}

export function MarketOverview({
  tokens,
  selectedTokenUuid,
  onSelectToken,
  isLoading,
  isEligible,
  error,
  onRetry,
}: MarketOverviewProps) {
  return (
    <Section title="Market">
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
          <p>{isEligible ? DIRECTORY_COPY.MARKET_EMPTY_TITLE : DIRECTORY_COPY.INELIGIBLE_TITLE}</p>
          <p className="text-text-muted">
            {isEligible ? DIRECTORY_COPY.MARKET_EMPTY_BODY : DIRECTORY_COPY.MARKET_INELIGIBLE_BODY}
          </p>
          {!isEligible && (
            <Link className="underline" to="/investor-eligibility">
              Verify my investor status
            </Link>
          )}
        </div>
      ) : (
        tokens.map((token) => (
          <div key={token.uuid} className="border-b border-border-subtle py-3">
            <button
              className="break-words text-left font-medium underline"
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
