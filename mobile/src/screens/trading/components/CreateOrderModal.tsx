import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import {
  formatShareCount,
  type ShareToken,
  type CreateOrderRequest,
  type Wallet,
  type OrderType,
  type WhitelistStatus,
} from '@ledova/shared';
import { Action, Row } from '../../../components/Ledger';
import { AccountModal } from '../../account/AccountModal';
import { marketAmount, priceCents } from '../marketData';
import { useMarketStyles } from '../styles';

interface CreateOrderModalProps {
  visible: boolean;
  onClose: () => void;
  token: ShareToken;
  orderType: OrderType;
  wallets: Wallet[];
  walletsWithHoldings: { walletAddress: string; balance: string }[];
  onSubmit: (data: CreateOrderRequest) => Promise<boolean>;
  submissionError: string | null;
  isWalletWhitelisted: (address: string) => boolean;
  getWhitelistStatus: (address: string) => WhitelistStatus | undefined;
  isLoadingWhitelistStatus: boolean;
  blocked?: boolean;
  onRetry?: () => void;
}

function wholeInput(value: string): bigint | null {
  if (!/^\d{1,19}$/.test(value)) return null;
  const amount = BigInt(value);
  return amount <= 9223372036854775807n ? amount : null;
}

export function CreateOrderModal({
  visible,
  onClose,
  token,
  orderType,
  wallets,
  walletsWithHoldings,
  onSubmit,
  submissionError,
  isWalletWhitelisted,
  getWhitelistStatus,
  isLoadingWhitelistStatus,
  blocked,
  onRetry,
}: CreateOrderModalProps) {
  const styles = useMarketStyles();
  const [quantity, setQuantity] = useState('');
  const [minimum, setMinimum] = useState('');
  const [price, setPrice] = useState('');
  const [walletUuid, setWalletUuid] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const transition = useRef({ generation: 0, pending: false });
  const scope = `${visible}/${token.uuid}/${orderType}`;
  const initial = useRef({ price: token.lastPrice ?? '', walletUuid: wallets[0]?.uuid ?? null });
  useLayoutEffect(() => {
    initial.current = { price: token.lastPrice ?? '', walletUuid: wallets[0]?.uuid ?? null };
  });
  useEffect(() => {
    transition.current.generation++;
    transition.current.pending = false;
    setPending(false);
    setFailure(null);
    setQuantity('');
    setMinimum('');
    setPrice(initial.current.price);
    setWalletUuid(initial.current.walletUuid);
  }, [scope]);
  const wallet = wallets.find((item) => item.uuid === walletUuid);
  const balance = walletsWithHoldings.find(
    (item) => item.walletAddress.toLowerCase() === wallet?.address.toLowerCase(),
  )?.balance;
  const amount = wholeInput(quantity);
  const min = wholeInput(minimum || '0');
  const cents = /^\d{1,16}(\.\d{1,2})?$/.test(price) ? priceCents(price) : null;
  const available = balance && /^\d+$/.test(balance) ? BigInt(balance) : null;
  const valid =
    !!wallet &&
    amount !== null &&
    amount > 0 &&
    min !== null &&
    min <= amount &&
    cents !== null &&
    cents > 0 &&
    (orderType === 'buy' || (available !== null && available >= amount));
  const allowlisted = !!wallet && isWalletWhitelisted(wallet.address);
  const status = wallet ? getWhitelistStatus(wallet.address) : undefined;
  const disabled = pending || !!blocked || isLoadingWhitelistStatus || !valid || !allowlisted;
  const submit = async () => {
    if (!visible || disabled || transition.current.pending || !wallet || amount === null || min === null) return;
    const generation = transition.current.generation;
    transition.current.pending = true;
    setPending(true);
    setFailure(null);
    try {
      await onSubmit({
        token: token.uuid,
        orderType,
        walletUuid: wallet.uuid,
        walletAddress: wallet.address,
        quantity: amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : amount.toString(),
        minQuantity: min === 0n ? undefined : min <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(min) : min.toString(),
        pricePerShare: price,
      });
    } catch {
      if (generation === transition.current.generation)
        setFailure('The order could not be prepared. Your draft is retained.');
    } finally {
      if (generation === transition.current.generation) {
        transition.current.pending = false;
        setPending(false);
      }
    }
  };
  const dismiss = () => {
    if (transition.current.pending) return;
    transition.current.generation++;
    onClose();
  };
  return (
    <AccountModal
      visible={visible}
      title={`${orderType === 'buy' ? 'Wanted' : 'For sale'} · ${token.symbol}`}
      busy={pending}
      onClose={dismiss}
      actions={
        <Action
          label={orderType === 'buy' ? 'Buy' : 'Sell'}
          primary
          disabled={disabled}
          onPress={() => void submit()}
        />
      }
    >
      <Text style={styles.text}>{token.name}</Text>
      <Text style={styles.muted}>
        Orders match automatically. Buyers fund their payment wallet before placing an offer.
      </Text>
      {blocked && (
        <View style={styles.fields}>
          <Text accessibilityRole="alert" style={styles.error}>
            Current share class, eligibility or wallet details are unavailable. Your draft is retained.
          </Text>
          <Action label="Refresh trading details" disabled={pending} onPress={() => onRetry?.()} />
        </View>
      )}
      {(submissionError || failure) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {submissionError || failure}
        </Text>
      )}
      <Text style={styles.text}>{orderType === 'buy' ? 'Delivery wallet' : 'Source wallet'}</Text>
      {wallets.length === 0 && <Text style={styles.muted}>No verified trading wallets are available.</Text>}
      {wallets.map((item) => (
        <View key={item.uuid} style={styles.fields}>
          <Action
            label={item.name || item.address}
            primary={walletUuid === item.uuid}
            disabled={pending || blocked}
            onPress={() => setWalletUuid(item.uuid)}
          />
          <Text selectable style={styles.muted}>
            {item.address}
          </Text>
        </View>
      ))}
      {isLoadingWhitelistStatus ? (
        <Text style={styles.muted}>Checking wallet allowlist…</Text>
      ) : (
        wallet &&
        !allowlisted && (
          <View style={styles.fields}>
            <Text accessibilityRole="alert" style={styles.error}>
              {!status || status.status === 'unknown'
                ? 'Allowlist status unavailable. Retry the check to continue.'
                : 'The operator must allowlist this wallet before an order can be placed.'}
            </Text>
            <Action label="Retry allowlist check" disabled={pending} onPress={() => onRetry?.()} />
          </View>
        )
      )}
      {orderType === 'sell' && (
        <Row label="Available shares">
          {available === null ? 'Unavailable' : formatShareCount(available.toString())}
        </Row>
      )}
      <Text style={styles.text}>Quantity (whole shares)</Text>
      <TextInput
        accessibilityLabel="Quantity"
        placeholder="Enter number of shares"
        style={styles.input}
        value={quantity}
        onChangeText={setQuantity}
        keyboardType="number-pad"
        editable={!pending}
      />
      <Text style={styles.text}>Minimum fill quantity (optional)</Text>
      <TextInput
        accessibilityLabel="Minimum fill quantity"
        placeholder="0 = accept any partial fill"
        style={styles.input}
        value={minimum}
        onChangeText={setMinimum}
        keyboardType="number-pad"
        editable={!pending}
      />
      <Text style={styles.text}>Price per share (AUD)</Text>
      <TextInput
        accessibilityLabel="Price per share"
        placeholder="Enter price per share"
        style={styles.input}
        value={price}
        onChangeText={setPrice}
        keyboardType="decimal-pad"
        editable={!pending}
      />
      <Text style={styles.muted}>
        Use whole shares up to 9,223,372,036,854,775,807 and a positive price with at most two decimal places. Minimum
        fill cannot exceed quantity.
      </Text>
      <Row label="Total">{amount !== null ? marketAmount(price, amount) : 'Unavailable'}</Row>
    </AccountModal>
  );
}
