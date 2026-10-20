import type { ReactNode } from 'react';
import { useState } from 'react';
import {
  ShieldCheckIcon,
  ShieldIcon,
  HardDriveIcon,
  CloudIcon,
  CurrencyEthIcon,
  CurrencyBtcIcon,
} from '@phosphor-icons/react';
import {
  FIELD_LIMITS,
  formatCryptoBalance,
  formatWalletAddressMedium,
  formatDate,
  getChainShortCode,
  isBitcoinChain,
  WALLET_VERIFICATION_STATUS,
  WALLET_SIGNING_PREFERENCE,
  getWalletSigningPreferenceLabel,
  useCurrency,
} from '@ledova/shared';
import { ICON_SM } from '@components/iconSizes';
import type { Wallet as WalletType } from '@ledova/shared';
import { Modal } from '@components/Modal';
import { Row, Rows } from '@components/Ledger';
import { FIELD_BASE } from '@components/fieldClass';

interface EditWalletModalProps {
  readBlocked?: boolean;
  notice?: ReactNode;
  error?: string | null;
  wallet: WalletType | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (uuid: string, name: string) => void;
  isUpdating: boolean;
}

export function EditWalletModal({
  wallet,
  isOpen,
  onClose,
  onSave,
  isUpdating,
  error,
  readBlocked,
  notice,
}: EditWalletModalProps) {
  const { formatDisplayCurrency } = useCurrency();
  const [name, setName] = useState(wallet?.name || '');

  if (!wallet) return null;

  const chainShortName = getChainShortCode(wallet.chain);
  const marketValue = parseFloat(wallet.nativeMarketValue) || 0;
  const isHardware = wallet.signingPreference === WALLET_SIGNING_PREFERENCE.HARDWARE;
  const isVerified = wallet.verificationStatus === WALLET_VERIFICATION_STATUS.VERIFIED;
  const isBtc = isBitcoinChain(chainShortName);
  const ChainIcon = isBtc ? CurrencyBtcIcon : CurrencyEthIcon;

  const handleSave = () => {
    if (!isUpdating && !readBlocked) onSave(wallet.uuid, name.trim());
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Edit wallet"
      showFooter
      confirmLabel="Save"
      busy={isUpdating}
      busyLabel="Saving…"
      confirmDisabled={readBlocked}
      onConfirm={handleSave}
    >
      <div className="space-y-4">
        {notice}
        {error && (
          <p role="alert" className="text-sm text-error-light">
            {error}
          </p>
        )}
        <Rows>
          <Row label="Value">
            <span className="inline-flex items-center gap-1.5">
              <ChainIcon size={ICON_SM} className="text-text-muted" />
              {formatDisplayCurrency(marketValue)}
            </span>
          </Row>
          <Row label="Address">{formatWalletAddressMedium(wallet.address)}</Row>
          <Row label="Balance">{formatCryptoBalance(wallet.nativeBalance, chainShortName)}</Row>
          <Row label="Signing preference">
            <span className="inline-flex items-center gap-1.5">
              {getWalletSigningPreferenceLabel(wallet.signingPreference)}
              {wallet.signingPreference &&
                (isHardware ? (
                  <HardDriveIcon size={ICON_SM} weight="bold" className="text-text-secondary" />
                ) : (
                  <CloudIcon size={ICON_SM} weight="bold" className="text-text-secondary" />
                ))}
            </span>
          </Row>
          <Row label="Last sync">{formatDate(wallet.lastSyncedAt)}</Row>
          <Row label="Verification">
            <span
              className={`inline-flex items-center gap-1.5 ${isVerified ? 'text-success-light' : 'text-warning-light'}`}
            >
              {isVerified ? 'Address verified' : 'Pending'}
              {isVerified ? <ShieldCheckIcon size={ICON_SM} /> : <ShieldIcon size={ICON_SM} />}
            </span>
          </Row>
        </Rows>

        <div className="space-y-1">
          <label className="text-sm font-medium text-text-primary">Wallet name</label>
          <input
            type="text"
            aria-label="Wallet name"
            disabled={isUpdating}
            maxLength={FIELD_LIMITS.WALLET_NAME}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={FIELD_BASE}
            placeholder="Enter wallet name (optional)"
          />
          <p className="text-xs text-text-muted">Give your wallet a memorable name</p>
        </div>
      </div>
    </Modal>
  );
}
