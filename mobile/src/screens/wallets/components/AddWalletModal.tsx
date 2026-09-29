import React, { useEffect } from 'react';
import { Action } from '../../../components/Ledger';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { QrCodeIcon } from 'phosphor-react-native';
import { getChainConfig, getAddressPlaceholder } from '@ledova/shared';
import type { CreateWallet, DerivedAddress, HardwareWalletImport, WalletSigningPreference } from '@ledova/shared';
import type { SoftwareWalletImport } from '../../../utils/softwareWallet';
import { AnimatedQRScanner } from '../../../components/qr';
import { CustomModal, useDialogStyles } from '../../../components/modal';
import { HardwareAccountSelector } from './HardwareAccountSelector';
import { WalletSigningPreferenceSelector } from './WalletSigningPreferenceSelector';
import { useSeedPhraseSetup } from './SeedPhraseSetup';
import { WalletNetworkSelector } from './WalletNetworkSelector';
import { useAppTheme, useThemedStyles } from '../../../contexts';
import { useAddWalletForm, FORM_STEPS } from '../useAddWalletForm';

interface AddWalletModalProps {
  visible: boolean;
  isLoading: boolean;
  readBlocked: boolean;
  notice: string | null;
  error: string | null;
  onRetry: () => void;
  preselectedChain?: 'BTC' | 'ETH' | null;
  onClose: () => void;
  onSubmit: (data: CreateWallet) => Promise<void>;
  onBatchSubmit: (addresses: DerivedAddress[], importData: HardwareWalletImport) => Promise<void>;
  onSoftwareWalletCreate?: (addresses: DerivedAddress[], importData: SoftwareWalletImport) => Promise<void>;
}

export function AddWalletModal({
  visible,
  isLoading,
  preselectedChain,
  readBlocked,
  notice,
  error,
  onRetry,
  onClose,
  onSubmit,
  onBatchSubmit,
  onSoftwareWalletCreate,
}: AddWalletModalProps) {
  const theme = useAppTheme();
  const text = useDialogStyles();
  const styles = useThemedStyles((theme) => ({
    feedback: {
      gap: theme.spacing.sm,
    },
    inputGroup: {
      gap: theme.spacing.xs,
    },
    labelRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    label: {
      fontFamily: theme.fontFamily.medium,
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.primary,
    },
    scanButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.xs,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.xs,
    },
    scanButtonText: {
      fontFamily: theme.fontFamily.medium,
      fontSize: theme.fontSize.sm,
      color: theme.colors.interactive.defaultSubtle,
    },
    scannerContainer: {
      alignItems: 'center',
    },
    mono: {
      fontFamily: theme.fontFamily.mono,
    },
    inputError: {
      borderColor: theme.colors.status.error.text,
    },
    errorText: {
      fontFamily: theme.fontFamily.regular,
      fontSize: theme.fontSize.xs,
      color: theme.colors.status.error.text,
    },
  }));
  const form = useAddWalletForm({
    onSubmit: (data) => {
      if (!isLoading && !readBlocked) void onSubmit(data).catch(() => undefined);
    },
    onBatchSubmit: (addresses, importData) => {
      if (!isLoading && !readBlocked) void onBatchSubmit(addresses, importData).catch(() => undefined);
    },
    preselectedChain,
  });

  useEffect(() => {
    form.reset();
  }, [visible]);

  const handleClose = () => {
    if (isLoading) return;
    form.reset();
    onClose();
  };

  const handleWalletSigningPreferenceSelect = (type: WalletSigningPreference) => {
    form.setWalletSigningPreference(type);
    if (type === 'software') {
      form.setStep(FORM_STEPS.SEED_PHRASE);
    } else if (type === 'hardware') {
      form.setStep(FORM_STEPS.INPUT);
      form.setShowScannerDirect(true);
    }
  };

  const handleSoftwareWalletComplete = (addresses: DerivedAddress[], importData: SoftwareWalletImport) => {
    if (!onSoftwareWalletCreate || isLoading || readBlocked)
      return Promise.reject(new Error('Refresh wallets before continuing.'));
    return onSoftwareWalletCreate(addresses, importData);
  };

  const backToType = () => {
    if (!isLoading) form.setStep(FORM_STEPS.SELECT_TYPE);
  };

  const seed = useSeedPhraseSetup({
    visible: visible && form.step === FORM_STEPS.SEED_PHRASE,
    onClose: handleClose,
    onComplete: handleSoftwareWalletComplete,
    onCancel: backToType,
    readBlocked,
  });

  const feedback = (notice || error) && (
    <View style={styles.feedback}>
      {notice && (
        <Text accessibilityRole="alert" style={styles.errorText}>
          {notice}
        </Text>
      )}
      {notice && <Action label="Retry wallets" disabled={isLoading} onPress={onRetry} />}
      {error && (
        <Text accessibilityRole="alert" style={styles.errorText}>
          {error}
        </Text>
      )}
    </View>
  );

  const modalProps = {
    visible,
    title: 'Add wallet',
    onClose: handleClose,
    showFooter: true,
    showCancelButton: true,
    cancelLabel: 'Close',
    onCancel: handleClose,
    confirmLoading: isLoading,
  } as const;

  const resolveStep = () => {
    if (form.step === FORM_STEPS.SELECT_ADDRESSES && form.scannedURString) return FORM_STEPS.SELECT_ADDRESSES;
    return form.step;
  };

  const renderContent = () => {
    switch (resolveStep()) {
      case FORM_STEPS.SELECT_TYPE:
        return (
          <CustomModal contentKey="wallet-type" {...modalProps}>
            {feedback}
            <WalletSigningPreferenceSelector onSelect={handleWalletSigningPreferenceSelect} />
          </CustomModal>
        );

      case FORM_STEPS.SEED_PHRASE:
        return (
          <CustomModal contentKey="wallet-seed" visible={visible} title="Add wallet" {...seed.modal}>
            {feedback}
            {seed.content}
          </CustomModal>
        );

      case FORM_STEPS.SELECT_ADDRESSES:
        return (
          <CustomModal contentKey="wallet-addresses" {...modalProps} showFooter={false}>
            {feedback}
            <HardwareAccountSelector
              urString={form.scannedURString!}
              onSelectAccounts={form.handleAddressSelection}
              onCancel={() => {
                if (!isLoading) form.handleBackToInput();
              }}
              disabled={isLoading || readBlocked}
            />
          </CustomModal>
        );

      case FORM_STEPS.INPUT:
      default:
        return (
          <CustomModal
            contentKey="wallet-input"
            {...modalProps}
            cancelLabel="Back"
            onCancel={backToType}
            confirmLabel="Add Wallet"
            onConfirm={form.handleSubmit}
            confirmLoading={isLoading}
            confirmDisabled={isLoading || readBlocked}
          >
            {feedback}
            <WalletNetworkSelector
              network={form.selectedChain ?? ''}
              onChange={form.setSelectedChain}
              disabled={isLoading}
            />
            <Text style={text.muted}>
              {form.showScanner ? 'Scan your wallet QR code' : 'Enter wallet details or scan a QR code'}
            </Text>

            <View style={styles.inputGroup}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>Wallet Address</Text>
                <TouchableOpacity style={styles.scanButton} onPress={form.toggleScanner} disabled={isLoading}>
                  <QrCodeIcon
                    size={theme.icon.sizes.md}
                    color={theme.colors.interactive.defaultSubtle}
                    weight={theme.icon.weights.regular}
                  />
                  <Text style={styles.scanButtonText}>{form.showScanner ? 'Hide Scanner' : 'Scan QR'}</Text>
                </TouchableOpacity>
              </View>

              {form.showScanner ? (
                <View style={styles.scannerContainer}>
                  <AnimatedQRScanner active={visible && !isLoading} onComplete={form.handleQRScan} />
                </View>
              ) : (
                <>
                  <TextInput
                    style={[text.field, styles.mono, form.errors.address && styles.inputError]}
                    accessibilityLabel="Wallet address"
                    value={form.address}
                    onChangeText={form.handleAddressChange}
                    placeholder={getAddressPlaceholder(
                      form.selectedChain ? getChainConfig(form.selectedChain)?.shortName || 'ETH' : 'ETH',
                    )}
                    placeholderTextColor={theme.colors.text.muted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!isLoading}
                  />
                  {form.errors.address && <Text style={styles.errorText}>{form.errors.address}</Text>}
                </>
              )}
            </View>

            {!form.showScanner && (
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Wallet Name (Optional)</Text>
                <TextInput
                  style={text.field}
                  accessibilityLabel="Wallet name"
                  value={form.name}
                  onChangeText={form.setName}
                  placeholder="e.g., Savings, Trading, Cold Storage"
                  placeholderTextColor={theme.colors.text.muted}
                  autoCapitalize="words"
                  autoCorrect={false}
                  editable={!isLoading}
                  maxLength={100}
                />
              </View>
            )}
          </CustomModal>
        );
    }
  };

  return renderContent();
}
