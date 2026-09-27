import { useState, useEffect, useMemo, useImperativeHandle, forwardRef } from 'react';
import { formatWalletAddressShort } from '@ledova/shared';
import type { ShareToken, CreateOrderRequest, Wallet, OrderType } from '@ledova/shared';
import { Rows, Row } from '@components/Ledger';
import { marketAmount, priceCents } from '../marketData';

interface OrderFormProps {
  token: ShareToken;
  orderType: OrderType;
  wallets: Wallet[];
  defaultWalletUuid?: string;
  getWalletBalance?: (address: string) => string | undefined;
  onSubmit: (data: CreateOrderRequest) => void;
  onValidationChange?: (isValid: boolean) => void;
  onWalletChange?: (address: string) => void;
  disabled?: boolean;
}

export interface OrderFormRef {
  submit: () => void;
  isValid: boolean;
}

function wholeInput(value: string): bigint | null {
  if (!/^\d{1,19}$/.test(value)) return null;
  const parsed = BigInt(value);
  return parsed <= 9223372036854775807n ? parsed : null;
}

export const OrderForm = forwardRef<OrderFormRef, OrderFormProps>(function OrderForm(
  {
    token,
    orderType,
    wallets,
    defaultWalletUuid,
    getWalletBalance,
    onSubmit,
    onValidationChange,
    onWalletChange,
    disabled = false,
  },
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
  useEffect(() => {
    onValidationChange?.(isValid);
  }, [isValid, onValidationChange]);
  const handleSubmit = () => {
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
  useImperativeHandle(ref, () => ({ submit: handleSubmit, isValid }));
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
        <div className="space-y-1">
          <label htmlFor="order-wallet" className="block text-sm">
            {isBuy ? 'Delivery wallet' : 'Source wallet'}
          </label>
          <select
            id="order-wallet"
            value={selectedWalletUuid}
            onChange={(event) => setSelectedWalletUuid(event.target.value)}
            className="w-full border border-border bg-transparent p-3 text-sm"
          >
            <option value="" disabled>
              Select a wallet
            </option>
            {wallets.map((wallet) => (
              <option key={wallet.uuid} value={wallet.uuid}>
                {wallet.name || formatWalletAddressShort(wallet.address)}
              </option>
            ))}
          </select>
          {selectedWallet && <p className="break-all text-xs text-text-muted">{selectedWallet.address}</p>}
          {wallets.length === 0 && (
            <p className="text-sm text-text-muted">No available wallet{isBuy ? '.' : ' with these shares.'}</p>
          )}
        </div>
        <div className="space-y-1">
          <label htmlFor="order-quantity" className="block text-sm">
            Quantity (shares)
          </label>
          <input
            id="order-quantity"
            type="number"
            min="1"
            step="1"
            max="9223372036854775807"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            placeholder="Enter number of shares"
            className="w-full border border-border bg-transparent p-3 text-sm"
          />
          {quantity && (qty === null || qty <= 0) && (
            <p role="alert" className="text-sm">
              Enter a positive whole quantity up to 9,223,372,036,854,775,807 shares.
            </p>
          )}
          {!isBuy && balance !== undefined && (
            <button type="button" className="text-sm underline" onClick={() => setQuantity(balance)}>
              Use Max
            </button>
          )}
          {!withinBalance && <p className="text-sm">The source wallet does not have this quantity available.</p>}
        </div>
        <div>
          <button type="button" className="text-sm underline" onClick={() => setShowAdvanced(!showAdvanced)}>
            {showAdvanced ? 'Hide advanced options' : 'Advanced options'}
          </button>
          {showAdvanced && (
            <div className="mt-3 space-y-1">
              <label htmlFor="order-minimum" className="block text-sm">
                Minimum fill quantity (optional)
              </label>
              <input
                id="order-minimum"
                type="number"
                min="0"
                step="1"
                max={quantity || undefined}
                value={minQuantity}
                onChange={(event) => setMinQuantity(event.target.value)}
                placeholder="0 = accept any partial fill"
                className="w-full border border-border bg-transparent p-3 text-sm"
              />
              <p className="text-xs text-text-muted">Leave empty or 0 to accept any partial fill.</p>
              {minQuantity && (minimum === null || qty === null || minimum > qty) && (
                <p role="alert" className="text-sm">
                  Minimum quantity must be a whole number no greater than the total.
                </p>
              )}
            </div>
          )}
        </div>
        <div className="space-y-1">
          <label htmlFor="order-price" className="block text-sm">
            Price per share (AUD)
          </label>
          <input
            id="order-price"
            type="number"
            min="0.01"
            step="0.01"
            value={pricePerShare}
            onChange={(event) => setPricePerShare(event.target.value)}
            placeholder="Enter price per share"
            className="w-full border border-border bg-transparent p-3 text-sm"
          />
          {pricePerShare && (cents === null || cents <= 0n) && (
            <p role="alert" className="text-sm">
              Enter a positive AUD price with at most two decimal places and 16 whole digits.
            </p>
          )}
        </div>
      </fieldset>
    </div>
  );
});
