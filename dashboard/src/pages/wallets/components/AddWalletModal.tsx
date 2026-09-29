import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { QrCodeIcon, CheckIcon } from '@phosphor-icons/react';
import {
  getBlockchainDisplayName,
  getActiveChains,
  importAddressKey,
  importOnEvmNetwork,
  DESIGN_TOKENS,
  fetchImportBalances,
  describeFailure,
} from '@ledova/shared';

const ICON_XS = DESIGN_TOKENS.icon.sizes.xs;
const ICON_SM = DESIGN_TOKENS.icon.sizes.sm;
import type { CreateWallet, DerivedAddress, HardwareWalletImport } from '@ledova/shared';
import { Modal, ModalActions } from '@components/Modal';
import { PageAction } from '@components/Page';
import apiClient from '@services/apiClient';
import { useWalletForm } from '../hooks/useWalletForm';
import { extractFromKeystoneQR } from '@utils/keystone/bcurDecoder';

const FIELD_CLASS =
  'block w-full rounded-lg border bg-surface-raised px-3 py-2 text-sm text-text-primary ' +
  'placeholder:text-text-muted focus:border-brand-mid focus:outline-none focus:ring-1 focus:ring-brand-mid';

interface AddWalletModalProps {
  readBlocked?: boolean;
  notice?: ReactNode;
  error?: string | null;
  isOpen: boolean;
  isLoading: boolean;
  onClose: () => void;
  onSubmit: (data: CreateWallet) => void;
  onBatchSubmit: (addresses: DerivedAddress[], importData: HardwareWalletImport) => void;
}

export function AddWalletModal({
  isOpen,
  isLoading,
  onClose,
  onSubmit,
  onBatchSubmit,
  error,
  readBlocked,
  notice,
}: AddWalletModalProps) {
  const form = useWalletForm({
    onSubmit,
    onBatchSubmit,
  });

  useEffect(() => {
    if (isOpen) {
      form.reset();
    }
  }, [isOpen]);

  const handleClose = () => {
    if (isLoading) return;
    form.stopScanner();
    form.reset();
    onClose();
  };

  if (form.isSelectingAddresses && form.scannedURString) {
    return (
      <Modal isOpen={isOpen} onClose={handleClose} title="Add wallet">
        {notice}
        {error && (
          <p role="alert" className="mb-3 text-sm text-error-light">
            {error}
          </p>
        )}
        <AccountSelector
          urString={form.scannedURString}
          onSelectAccounts={(addresses, data) => {
            if (!readBlocked && !isLoading) form.handleAddressSelection(addresses, data);
          }}
          onCancel={form.handleBackToInput}
          isLoading={isLoading || !!readBlocked}
        />
      </Modal>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Add wallet"
      showFooter={!form.showScanner}
      confirmLabel={isLoading ? 'Adding...' : 'Add Wallet'}
      confirmLoading={isLoading}
      confirmDisabled={isLoading || readBlocked || !form.address.trim()}
      onConfirm={() => {
        if (!readBlocked && !isLoading) form.handleSubmit();
      }}
    >
      <div className="space-y-4">
        {notice}
        {error && (
          <p role="alert" className="text-sm text-error-light">
            {error}
          </p>
        )}
        <p className="text-sm text-text-muted">
          {form.showScanner ? 'Scan your wallet QR code' : 'Enter wallet details or scan a QR code'}
        </p>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-sm text-text-muted">Wallet Address</label>
            <button
              type="button"
              onClick={form.toggleScanner}
              disabled={isLoading}
              className="flex items-center gap-1 text-sm text-brand-mid hover:text-brand-light transition-colors"
            >
              <QrCodeIcon size={ICON_SM} />
              <span>{form.showScanner ? 'Hide Scanner' : 'Scan QR'}</span>
            </button>
          </div>

          {form.showScanner ? (
            <div className="space-y-3">
              <div className="relative overflow-hidden rounded-lg bg-black mx-auto" style={{ width: 280, height: 280 }}>
                <div id="wallet-qr-scanner" className="w-full h-full" />
              </div>

              {form.scanProgress && (
                <div className="flex items-center justify-center">
                  <span className="text-xs bg-brand-mid text-white px-3 py-1 rounded-full">
                    Scanning: {form.scanProgress.received}/{form.scanProgress.total > 0 ? form.scanProgress.total : '?'}{' '}
                    parts
                  </span>
                </div>
              )}

              {form.scannerError && <p className="text-center text-sm text-error-light">{form.scannerError}</p>}
            </div>
          ) : (
            <>
              <input
                type="text"
                aria-label="Wallet address"
                value={form.address}
                onChange={(e) => form.handleAddressChange(e.target.value)}
                className={`${FIELD_CLASS} font-mono ${form.errors.address ? 'border-error-light' : 'border-border'}`}
                placeholder="0x... or tb1..."
                disabled={isLoading}
              />
              {form.errors.address && <p className="text-xs text-error-light">{form.errors.address}</p>}
            </>
          )}
        </div>

        {!form.showScanner && (
          <label className="block space-y-1 text-sm text-text-muted">
            <span>Wallet network</span>
            <select
              aria-label="Wallet network"
              disabled={isLoading}
              value={form.selectedChain ?? ''}
              onChange={(event) => form.setSelectedChain(event.target.value)}
              className={`${FIELD_CLASS} border-border`}
            >
              {getActiveChains().map((chain) => (
                <option key={chain.code} value={chain.code}>
                  {chain.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {!form.showScanner && (
          <div className="space-y-1">
            <label className="text-sm text-text-muted">Wallet Name (Optional)</label>
            <input
              type="text"
              aria-label="Wallet name"
              value={form.name}
              onChange={(e) => form.setName(e.target.value)}
              className={`${FIELD_CLASS} border-border`}
              placeholder="e.g., Savings, Trading, Cold Storage"
              disabled={isLoading}
              maxLength={100}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}

interface AccountSelectorProps {
  urString: string;
  onSelectAccounts: (addresses: DerivedAddress[], importData: HardwareWalletImport) => void;
  onCancel: () => void;
  isLoading: boolean;
}

function decodeImport(urString: string, evmNetwork: 'ETH' | 'BASE') {
  try {
    const decoded = extractFromKeystoneQR(urString);
    return decoded ? importOnEvmNetwork(decoded, evmNetwork) : null;
  } catch (error) {
    console.error(`Failed to extract QR data: ${describeFailure(error)}`);
    return null;
  }
}

export function AccountSelector({ urString, onSelectAccounts, onCancel, isLoading }: AccountSelectorProps) {
  const [evmNetwork, setEvmNetwork] = useState<'ETH' | 'BASE'>('ETH');
  const importData = useMemo(() => decodeImport(urString, evmNetwork), [urString, evmNetwork]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted">Review the accounts to import</p>

      {importData?.addresses.some((item) => item.networkType !== 'BTC') && (
        <label className="block space-y-1 text-sm text-text-muted">
          <span>EVM network</span>
          <select
            aria-label="Import EVM network"
            disabled={isLoading}
            value={evmNetwork}
            onChange={(event) => setEvmNetwork(event.target.value as 'ETH' | 'BASE')}
            className={`${FIELD_CLASS} border-border`}
          >
            <option value="ETH">Ethereum</option>
            <option value="BASE">Base</option>
          </select>
        </label>
      )}
      <ImportAccounts
        key={`${evmNetwork}/${urString}`}
        importData={importData}
        onSelectAccounts={onSelectAccounts}
        onCancel={onCancel}
        isImporting={isLoading}
      />
    </div>
  );
}

function ImportAccounts({
  importData,
  onSelectAccounts,
  onCancel,
  isImporting,
}: Omit<AccountSelectorProps, 'urString' | 'isLoading'> & {
  importData: HardwareWalletImport | null;
  isImporting: boolean;
}) {
  const addresses = importData?.addresses ?? [];
  const [selectedAddresses, setSelectedAddresses] = useState(() => new Set(addresses.map(importAddressKey)));
  const [balances, setBalances] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!importData) return;
    let active = true;
    void fetchImportBalances(apiClient, importData.addresses).then((next) => {
      if (active) setBalances(next);
    });
    return () => {
      active = false;
    };
  }, [importData]);

  const toggleSelection = (address: string) => {
    const newSelected = new Set(selectedAddresses);
    if (newSelected.has(address)) {
      newSelected.delete(address);
    } else {
      newSelected.add(address);
    }
    setSelectedAddresses(newSelected);
  };

  const handleImport = () => {
    if (!importData) return;
    const selected = addresses.filter((addr) => selectedAddresses.has(importAddressKey(addr)));
    onSelectAccounts(selected, importData);
  };

  return (
    <>
      <div className="max-h-[300px] divide-y divide-border-subtle overflow-y-auto">
        {addresses.map((derivedAddress) => {
          const isSelected = selectedAddresses.has(importAddressKey(derivedAddress));
          const balance = balances.get(importAddressKey(derivedAddress)) || 'Loading...';
          const networkName = getBlockchainDisplayName(derivedAddress.networkType);

          return (
            <button
              key={importAddressKey(derivedAddress)}
              type="button"
              aria-pressed={isSelected}
              onClick={() => toggleSelection(importAddressKey(derivedAddress))}
              disabled={isImporting}
              className="flex w-full items-center gap-3 py-3 text-left disabled:opacity-50"
            >
              <div
                className={`flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center ${
                  isSelected ? 'bg-brand-mid border-brand-mid' : 'border-border-strong'
                }`}
              >
                {isSelected && <CheckIcon size={ICON_XS} weight="bold" className="text-white" />}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-text-primary">{networkName}</span>
                  <span className="text-sm font-semibold text-text-primary">{balance}</span>
                </div>
                <p className="text-xs font-mono text-text-muted truncate">
                  {derivedAddress.address.slice(0, 10)}...{derivedAddress.address.slice(-8)}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      <ModalActions>
        <PageAction label="Cancel" onClick={onCancel} disabled={isImporting} />
        <PageAction
          label={
            isImporting
              ? 'Importing...'
              : `Import ${selectedAddresses.size} Wallet${selectedAddresses.size !== 1 ? 's' : ''}`
          }
          primary
          onClick={handleImport}
          disabled={selectedAddresses.size === 0 || isImporting}
        />
      </ModalActions>
    </>
  );
}
