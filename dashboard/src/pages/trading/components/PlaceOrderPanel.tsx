import { useRef, useState, useCallback } from 'react';
import type { ShareToken, CreateOrderRequest, Wallet, OrderType, WhitelistStatus } from '@ledova/shared';
import { ShieldWarningIcon } from '@phosphor-icons/react';
import { DESIGN_TOKENS } from '@ledova/shared';
import { Modal } from '@components/Modal';
import { PageAction } from '@components/Page';
import { OrderForm } from './OrderForm';
import type { OrderFormRef } from './OrderForm';

const ICON_MD = DESIGN_TOKENS.icon.sizes.md;

interface PlaceOrderPanelProps {
  token: ShareToken;
  wallets: Wallet[];
  walletsWithHoldings: { walletAddress: string; balance: string }[];
  onSubmit: (data: CreateOrderRequest) => Promise<boolean>;
  onNewOrder: () => void;
  onDismiss: () => void;
  submissionError: string | null;
  isLoadingWhitelistStatus: boolean;
  readsUnavailable?: boolean;
  getWalletWhitelistStatus: (address: string) => WhitelistStatus | undefined;
}

export function PlaceOrderPanel({
  token,
  wallets,
  walletsWithHoldings,
  onSubmit,
  onNewOrder,
  onDismiss,
  submissionError,
  isLoadingWhitelistStatus,
  readsUnavailable = false,
  getWalletWhitelistStatus,
}: PlaceOrderPanelProps) {
  const [orderType, setOrderType] = useState<OrderType | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFormValid, setIsFormValid] = useState(false);
  const formRef = useRef<OrderFormRef>(null);
  const [selectedAddress, setSelectedAddress] = useState('');
  const walletStatus = getWalletWhitelistStatus(selectedAddress);
  const walletAllowed = walletStatus?.isWhitelisted === true;
  const isWhitelistStatusUnknown = !walletStatus || walletStatus.status === 'unknown';
  const transition = useRef({ generation: 0, pending: false });

  const isOpen = orderType !== null;
  const isBuy = orderType === 'buy';

  const sellWallets = wallets.filter((w) =>
    walletsWithHoldings.some((h) => h.walletAddress.toLowerCase() === w.address.toLowerCase()),
  );
  const availableWallets = isBuy ? wallets : sellWallets;

  const handleOpen = (type: OrderType) => {
    transition.current.generation++;
    transition.current.pending = false;
    onNewOrder();
    setIsSubmitting(false);
    setOrderType(type);
    setIsFormValid(false);
  };

  const handleClose = () => {
    if (transition.current.pending) return;
    transition.current.generation++;
    transition.current.pending = false;
    onDismiss();
    setIsSubmitting(false);
    setOrderType(null);
    setIsFormValid(false);
  };

  const handleSubmit = useCallback(
    async (data: CreateOrderRequest) => {
      if (transition.current.pending || readsUnavailable || !walletAllowed) return;
      transition.current.pending = true;
      const generation = transition.current.generation;
      setIsSubmitting(true);
      try {
        const accepted = await onSubmit(data);
        if (accepted && transition.current.generation === generation) {
          setOrderType(null);
          setIsFormValid(false);
        }
      } finally {
        if (transition.current.generation === generation) {
          transition.current.pending = false;
          setIsSubmitting(false);
        }
      }
    },
    [onSubmit, readsUnavailable, walletAllowed],
  );

  const isConfirmDisabled =
    !isFormValid || isSubmitting || isLoadingWhitelistStatus || !walletAllowed || readsUnavailable;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <PageAction
          label={`New sell order — ${token.symbol}`}
          onClick={() => handleOpen('sell')}
          disabled={wallets.length === 0 || readsUnavailable}
        />
        <PageAction
          label={`New buy order — ${token.symbol}`}
          primary
          onClick={() => handleOpen('buy')}
          disabled={wallets.length === 0 || readsUnavailable}
        />
      </div>

      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        title={`${isBuy ? 'Buy' : 'Sell'} ${token.symbol}`}
        size="md"
        showFooter
        confirmLabel={isSubmitting ? 'Placing...' : `Place ${isBuy ? 'Buy' : 'Sell'} Order`}
        confirmDisabled={isConfirmDisabled}
        confirmLoading={isSubmitting}
        onConfirm={() => formRef.current?.submit()}
      >
        <div className="space-y-4">
          {readsUnavailable && (
            <p role="status" className="text-sm text-text-muted">
              Share classes and wallets must finish refreshing before placing this order.
            </p>
          )}
          {submissionError && (
            <p role="alert" className="text-sm text-error-light">
              {submissionError}
            </p>
          )}
          {!walletAllowed && !isLoadingWhitelistStatus && (
            <div className="flex items-start gap-2">
              <ShieldWarningIcon size={ICON_MD} className="mt-px flex-shrink-0 text-warning-light" />
              <div className="space-y-1">
                <h3 className="text-sm font-medium text-warning-light">
                  {isWhitelistStatusUnknown ? 'Allowlist Status Unavailable' : 'Wallet Not Allowlisted'}
                </h3>
                <p className="text-sm text-text-muted">
                  {isWhitelistStatusUnknown
                    ? 'We could not reach the network to check your allowlist status. Orders are held until the check succeeds - please try again shortly.'
                    : 'The operator must add your wallet to the allowlist before you can place orders.'}
                </p>
              </div>
            </div>
          )}

          {orderType && (
            <OrderForm
              ref={formRef}
              token={token}
              orderType={orderType}
              wallets={availableWallets}
              defaultWalletUuid={availableWallets[0]?.uuid}
              onSubmit={handleSubmit}
              onValidationChange={setIsFormValid}
              onWalletChange={setSelectedAddress}
              disabled={isSubmitting}
              getWalletBalance={(address) =>
                walletsWithHoldings.find((holding) => holding.walletAddress.toLowerCase() === address.toLowerCase())
                  ?.balance
              }
            />
          )}
        </div>
      </Modal>
    </>
  );
}
