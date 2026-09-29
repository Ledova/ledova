import { DESTINATIONS, SUBSCRIPTION_COPY, formatMoney, getErrorMessage } from '@ledova/shared';
import type { DirectoryOpenOffering, Wallet } from '@ledova/shared';
import { LinkRow, Row, Rows, Section } from '@components/Ledger';
import { PageAction } from '@components/Page';

const FIELD_CLASS =
  'mt-1 block w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text-primary ' +
  'placeholder:text-text-muted focus:border-brand-mid focus:outline-none focus:ring-1 focus:ring-brand-mid';

interface SubscribeFormProps {
  offering: DirectoryOpenOffering;
  draft: { quantity: string; wallet: string | null };
  onDraftChange: (draft: { quantity: string; wallet: string | null }) => void;
  wallets: Wallet[];
  busy: boolean;
  error: unknown;
  onSubscribe: (input: { wallet: string; quantity: number }) => void;
}

function applicationAmount(quantity: string, price: string) {
  if (!/^[1-9]\d*$/.test(quantity) || !Number.isSafeInteger(Number(quantity)) || !/^\d+(\.\d{1,2})?$/.test(price))
    return null;
  const [whole, fraction = ''] = price.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents <= 0n) return null;
  const total = BigInt(quantity) * cents;
  return `${total / 100n}.${String(total % 100n).padStart(2, '0')}`;
}

export function SubscribeForm({
  offering,
  draft,
  onDraftChange,
  wallets,
  busy,
  error,
  onSubscribe,
}: SubscribeFormProps) {
  const { quantity, wallet } = draft;
  const chosenWallet =
    wallet === null ? (wallets[0]?.uuid ?? '') : (wallets.find((item) => item.uuid === wallet)?.uuid ?? '');
  const amount = applicationAmount(quantity, offering.pricePerShare);
  const message = getErrorMessage(error, 'The application could not be created. Check the details and try again.');

  if (wallets.length === 0) {
    return (
      <Section title="Add a receiving wallet">
        <p className="py-2 text-sm text-text-muted">
          Shares are issued to a verified Base wallet you control. Add and verify one in Wallets before applying.
        </p>
        <LinkRow to={DESTINATIONS.wallets.path} label={DESTINATIONS.wallets.title} />
      </Section>
    );
  }

  return (
    <Section title="Apply for shares">
      <p className="text-sm text-text-muted">
        Choose your whole shares and receiving wallet. The offering price is stored on your application when you create
        the draft.
      </p>
      <div className="grid gap-4 py-2 sm:grid-cols-2">
        <label className="block min-w-0">
          <span className="text-sm text-text-primary">Shares</span>
          <input
            type="text"
            inputMode="numeric"
            value={quantity}
            onChange={(event) => onDraftChange({ ...draft, quantity: event.target.value })}
            className={FIELD_CLASS}
            placeholder="Whole shares"
            aria-invalid={quantity !== '' && amount === null}
            aria-describedby={quantity !== '' && amount === null ? 'share-quantity-error' : undefined}
          />
        </label>
        <label className="block min-w-0">
          <span className="text-sm text-text-primary">Receiving wallet (Base)</span>
          <select
            value={chosenWallet}
            onChange={(event) => onDraftChange({ ...draft, wallet: event.target.value })}
            className={FIELD_CLASS}
          >
            <option value="" disabled>
              Choose a receiving wallet
            </option>
            {wallets.map((item) => (
              <option key={item.uuid} value={item.uuid}>
                {item.name ? `${item.name} — ` : ''}
                {item.address}
              </option>
            ))}
          </select>
        </label>
      </div>
      {quantity !== '' && amount === null && (
        <p id="share-quantity-error" className="text-sm text-error-light">
          Enter a positive whole number of shares.
        </p>
      )}
      <Rows>
        <Row label="Amount on acceptance">
          <span className="break-all">{amount === null ? '—' : formatMoney(amount, offering.priceCurrency)}</span>
        </Row>
      </Rows>
      {message && (
        <p role="alert" className="text-sm text-error-light">
          {message}
        </p>
      )}
      <div className="py-2">
        <PageAction
          label={busy ? 'Creating draft…' : 'Create application'}
          primary
          disabled={busy || amount === null || !chosenWallet}
          onClick={() => {
            if (amount !== null && chosenWallet && !busy)
              onSubscribe({ wallet: chosenWallet, quantity: Number(quantity) });
          }}
        />
      </div>
      <p className="text-sm text-text-muted">{SUBSCRIPTION_COPY.DRAFT_HELP}</p>
    </Section>
  );
}
