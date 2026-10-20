import { SelectField } from '@components/SelectField';
import { DESTINATIONS, SUBSCRIPTION_COPY, formatMoney, applicationAmount, apiErrorSentence } from '@ledova/shared';
import type { DirectoryOpenOffering, Wallet } from '@ledova/shared';
import { LinkRow, Row, Rows, Section } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { FIELD_CLASS } from '@components/fieldClass';

const CREATE_FAILED = 'The application could not be created. Check the details and try again.';

interface SubscribeFormProps {
  offering: DirectoryOpenOffering;
  draft: { quantity: string; wallet: string | null };
  onDraftChange: (draft: { quantity: string; wallet: string | null }) => void;
  wallets: Wallet[];
  busy: boolean;
  error: unknown;
  onSubscribe: (input: { wallet: string; quantity: number }) => void;
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
  const message = error ? apiErrorSentence(error, CREATE_FAILED, CREATE_FAILED) : null;

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
        <div className="min-w-0">
          <SelectField
            label="Receiving wallet (Base)"
            options={[
              { value: '', label: 'Choose a receiving wallet', disabled: true },
              ...wallets.map((item) => ({
                value: item.uuid,
                label: `${item.name ? `${item.name} — ` : ''}${item.address}`,
              })),
            ]}
            value={chosenWallet}
            onChange={(wallet) => onDraftChange({ ...draft, wallet })}
          />
        </div>
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
          label="Create application"
          busy={busy}
          busyLabel="Creating draft…"
          primary
          disabled={amount === null || !chosenWallet}
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
