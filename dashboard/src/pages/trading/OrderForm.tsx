import { SelectField } from '@components/SelectField';
import { Field, TextInput } from '@components/Field';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { useState, useEffect, useMemo, useImperativeHandle, forwardRef } from 'react';
import {
  FIELD_LIMITS,
  MAX_ORDER_SHARES,
  formatShareCount,
  formatWalletAddressShort,
  marketAmount,
  priceCents,
} from '@ledova/shared';
import type { ShareToken, CreateOrderRequest, Wallet, OrderType } from '@ledova/shared';
import { Rows, Row } from '@components/Ledger';

interface OrderFormProps {
  token: ShareToken;
  orderType: OrderType;
  wallets: Wallet[];
  defaultWalletUuid?: string;
  getWalletBalance?: (address: string) => string | undefined;
  onSubmit: (data: CreateOrderRequest) => void;
  onWalletChange?: (address: string) => void;
  disabled?: boolean;
}

export interface OrderFormRef {
  submit: () => void;
}

function wholeInput(value: string): bigint | null {
  if (!/^\d{1,19}$/.test(value)) return null;
  const parsed = BigInt(value);
  return parsed <= MAX_ORDER_SHARES ? parsed : null;
}

export const OrderForm = forwardRef<OrderFormRef, OrderFormProps>(function OrderForm(
  { token, orderType, wallets, defaultWalletUuid, getWalletBalance, onSubmit, onWalletChange, disabled = false },
  ref,
) {
  const [quantity, setQuantity] = useState('');
  const [minQuantity, setMinQuantity] = useState('');
  const [pricePerShare, setPricePerShare] = useState(token.lastPrice ?? '');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedWalletUuid, setSelectedWalletUuid] = useState(defaultWalletUuid ?? '');
  useEffect(() => {
    if (defaultWalletUuid && !selectedWalletUuid) setSelectedWalletUuid(defaultWalletUuid);
  }, [defaultWalletUuid, selectedWalletUuid]);
  const selectedWallet = useMemo(
    () => wallets.find((wallet) => wallet.uuid === selectedWalletUuid),
    [wallets, selectedWalletUuid],
  );
  useEffect(() => {
    onWalletChange?.(selectedWallet?.address ?? '');
  }, [selectedWallet?.address, onWalletChange]);
  const balance = selectedWallet && getWalletBalance ? getWalletBalance(selectedWallet.address) : undefined;
  const qty = wholeInput(quantity);
  const minimum = wholeInput(minQuantity || '0');
  const cents = /^\d{1,16}(\.\d{1,2})?$/.test(pricePerShare) ? priceCents(pricePerShare) : null;
  const withinBalance =
    orderType !== 'sell' ||
    !getWalletBalance ||
    (balance !== undefined && /^\d+$/.test(balance) && qty !== null && BigInt(qty) <= BigInt(balance));
  const isValid =
    qty !== null &&
    qty > 0 &&
    minimum !== null &&
    minimum <= qty &&
    cents !== null &&
    cents > 0n &&
    !!selectedWallet &&
    withinBalance;
  const checks = useErrorSummary({
    wallet: !selectedWallet && 'Choose a wallet.',
    quantity:
      qty === null || qty <= 0
        ? `Enter a positive whole quantity up to ${formatShareCount(MAX_ORDER_SHARES.toString())} shares.`
        : !withinBalance && 'The source wallet does not have this quantity available.',
    minimum:
      (minimum === null || (qty !== null && minimum > qty)) &&
      'Minimum quantity must be a whole number no greater than the total.',
    price:
      (cents === null || cents <= 0n) &&
      'Enter a positive AUD price with at most two decimal places and 16 whole digits.',
  });
  const handleSubmit = () => {
    if (!checks.check()) {
      if (minimum === null || (qty !== null && minimum > qty)) setShowAdvanced(true);
      return;
    }
    if (!isValid || disabled || !selectedWallet || qty === null || minimum === null) return;
    onSubmit({
      token: token.uuid,
      orderType,
      walletUuid: selectedWallet.uuid,
      walletAddress: selectedWallet.address,
      quantity: qty <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(qty) : qty.toString(),
      minQuantity:
        minimum > 0 ? (minimum <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minimum) : minimum.toString()) : undefined,
      pricePerShare,
    });
  };
  useImperativeHandle(ref, () => ({ submit: handleSubmit }));
  const isBuy = orderType === 'buy';
  return (
    <div className="space-y-4">
      {isBuy && (
        <p className="text-sm text-text-muted">
          Fund your payment wallet before placing an offer. Matching is automatic; the matched trade still requires the
          existing approval and signatures.
        </p>
      )}
      <Rows>
        {token.lastPrice && (
          <Row label="Last price">
            <span className="break-all">{marketAmount(token.lastPrice)}</span>
          </Row>
        )}
        {!isBuy && balance !== undefined && (
          <Row label="Available shares">
            <span className="break-all">{balance}</span>
          </Row>
        )}
        <Row label="Total value">
          <span className="break-all">
            {qty !== null && cents !== null ? marketAmount(pricePerShare, qty) : 'Enter quantity and price'}
          </span>
        </Row>
      </Rows>
      <fieldset disabled={disabled} className="space-y-4">
        <ErrorSummary {...checks.summary} />
        <div className="space-y-1">
          <SelectField
            {...checks.field('wallet')}
            label={isBuy ? 'Delivery wallet' : 'Source wallet'}
            options={[
              { value: '', label: 'Select a wallet', disabled: true },
              ...wallets.map((wallet) => ({
                value: wallet.uuid,
                label: wallet.name || formatWalletAddressShort(wallet.address),
              })),
            ]}
            value={selectedWalletUuid}
            onChange={setSelectedWalletUuid}
          />
          {selectedWallet && <p className="break-all text-xs text-text-muted">{selectedWallet.address}</p>}
          {wallets.length === 0 && (
            <p className="text-sm text-text-muted">No available wallet{isBuy ? '.' : ' with these shares.'}</p>
          )}
        </div>
        <div className="space-y-1">
          <Field {...checks.field('quantity')} label="Quantity (shares)">
            <TextInput
              inputMode="numeric"
              maxLength={FIELD_LIMITS.ORDER_SHARES}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              placeholder="Enter number of shares"
            />
          </Field>
          {!isBuy && balance !== undefined && (
            <button type="button" className="text-sm underline" onClick={() => setQuantity(balance)}>
              Use max
            </button>
          )}
        </div>
        <div>
          <button type="button" className="text-sm underline" onClick={() => setShowAdvanced(!showAdvanced)}>
            {showAdvanced ? 'Hide advanced options' : 'Advanced options'}
          </button>
          {(showAdvanced || !!checks.field('minimum').error) && (
            <Field
              {...checks.field('minimum')}
              label="Minimum fill quantity"
              optional
              hint="Leave empty or 0 to accept any partial fill."
              className="mt-3"
            >
              <TextInput
                inputMode="numeric"
                maxLength={FIELD_LIMITS.ORDER_SHARES}
                value={minQuantity}
                onChange={(event) => setMinQuantity(event.target.value)}
                placeholder="0 = accept any partial fill"
              />
            </Field>
          )}
        </div>
        <Field {...checks.field('price')} label="Price per share (AUD)">
          <TextInput
            inputMode="decimal"
            maxLength={FIELD_LIMITS.PRICE}
            value={pricePerShare}
            onChange={(event) => setPricePerShare(event.target.value)}
            placeholder="Enter price per share"
          />
        </Field>
      </fieldset>
    </div>
  );
});
