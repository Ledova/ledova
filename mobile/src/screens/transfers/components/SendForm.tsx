import React from 'react';
import { View, Text, ActivityIndicator, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import { CurrencyBtcIcon, CurrencyEthIcon, CurrencyCircleDollarIcon, QrCodeIcon } from 'phosphor-react-native';
import { useAppTheme, useThemedStyles } from '../../../contexts';
import { Action, Rows } from '../../../components/Ledger';
import { useDialogStyles } from '../../../components/modal';
import {
  formatCryptoBalance,
  formatWalletAddressMedium,
  getAddressPlaceholder,
  isBitcoinChain,
  parseFiatValue,
  useCurrency,
} from '@ledova/shared';
import type { TransferableAsset } from '@ledova/shared';

interface SendFormProps {
  chainShortName: string;
  walletName: string;
  walletAddress: string;
  selectedAsset: TransferableAsset | null;
  transferableAssets: TransferableAsset[];
  toAddress: string;
  amount: string;
  isLoadingHoldings: boolean;
  holdingsError: string | null;
  isRetryingHoldings: boolean;
  retryHoldings: () => void;
  selectAsset: (asset: TransferableAsset) => void;
  setToAddress: (address: string) => void;
  setAmount: (amount: string) => void;
  useMaxAmount: () => void;
  onOpenAddressScanner: () => void;
}

export function SendForm({
  chainShortName,
  walletName,
  walletAddress,
  selectedAsset,
  transferableAssets,
  toAddress,
  amount,
  isLoadingHoldings,
  holdingsError,
  isRetryingHoldings,
  retryHoldings,
  selectAsset,
  setToAddress,
  setAmount,
  useMaxAmount,
  onOpenAddressScanner,
}: SendFormProps) {
  const theme = useAppTheme();
  const { formatDisplayCurrency } = useCurrency();
  const text = useDialogStyles();
  const styles = useThemedStyles((theme) => ({
    scrollContent: {
      flex: 1,
    },
    scrollContentContainer: {
      gap: theme.spacing.md,
    },
    loadingContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    failure: {
      gap: theme.spacing.smd,
    },
    wallet: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    walletName: {
      flexShrink: 1,
      fontFamily: theme.fontFamily.semibold,
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.primary,
    },
    assetRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 10,
    },
    assetRowLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    assetSymbol: {
      fontFamily: theme.fontFamily.medium,
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.primary,
    },
    assetRowRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.xs,
    },
    assetBalance: {
      fontSize: theme.fontSize.xs,
      color: theme.colors.text.muted,
    },
    assetSeparator: {
      fontSize: theme.fontSize.xs,
      color: theme.colors.text.subtle,
    },
    assetFiat: {
      fontFamily: theme.fontFamily.semibold,
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.primary,
    },
    assetTextSelected: {
      color: theme.colors.interactive.active,
    },
    inputSection: {
      gap: theme.spacing.sm,
    },
    inputLabel: {
      fontFamily: theme.fontFamily.medium,
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.primary,
    },
    labelRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    scanButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.xs,
    },
    scanButtonText: {
      fontFamily: theme.fontFamily.semibold,
      fontSize: theme.fontSize.sm,
      color: theme.colors.interactive.active,
    },
    useMaxLink: {
      fontFamily: theme.fontFamily.semibold,
      fontSize: theme.fontSize.sm,
      color: theme.colors.interactive.active,
    },
    fiatEstimate: {
      fontFamily: theme.fontFamily.medium,
      fontSize: theme.fontSize.xs,
      color: theme.colors.interactive.active,
    },
    gasWarningText: {
      fontSize: theme.fontSize.xs,
      color: theme.colors.status.warning.text,
    },
  }));
  const assetSymbol = selectedAsset?.symbol || chainShortName;
  const ChainIcon = isBitcoinChain(chainShortName) ? CurrencyBtcIcon : CurrencyEthIcon;

  const getAssetIcon = (asset: TransferableAsset, selected: boolean) => {
    const color = selected ? theme.colors.interactive.active : theme.colors.text.muted;
    const weight = selected ? 'duotone' : ('regular' as const);
    if (asset.isNative) {
      const NativeIcon = isBitcoinChain(chainShortName) ? CurrencyBtcIcon : CurrencyEthIcon;
      return <NativeIcon size={theme.icon.sizes.md} color={color} weight={weight} />;
    }
    return <CurrencyCircleDollarIcon size={theme.icon.sizes.md} color={color} weight={weight} />;
  };

  const balance = Number(selectedAsset?.balance);
  const marketValue = parseFiatValue(selectedAsset?.marketValue);
  const parsedAmount = Number(amount);
  const estimate =
    marketValue !== null && Number.isFinite(balance) && balance > 0 && parsedAmount > 0
      ? (marketValue / balance) * parsedAmount
      : null;
  const fiatEstimate = estimate !== null && Number.isFinite(estimate) ? estimate : null;

  if (isLoadingHoldings) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="small" color={theme.colors.interactive.active} />
        <Text style={text.muted}>Loading assets...</Text>
      </View>
    );
  }

  if (holdingsError) {
    return (
      <View style={styles.failure}>
        <Text accessibilityRole="alert" style={text.muted}>
          {holdingsError}
        </Text>
        <Action label="Try again" onPress={retryHoldings} disabled={isRetryingHoldings} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.scrollContent}
      contentContainerStyle={styles.scrollContentContainer}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.wallet}>
        <ChainIcon size={theme.icon.sizes.md} color={theme.colors.text.muted} weight={theme.icon.weights.regular} />
        <Text style={styles.walletName}>{walletName || formatWalletAddressMedium(walletAddress)}</Text>
      </View>

      {transferableAssets.length === 0 ? <Text style={text.muted}>This wallet has nothing to send.</Text> : null}

      {transferableAssets.length > 1 ? (
        <Rows>
          {transferableAssets.map((asset: TransferableAsset) => {
            const isSelected = selectedAsset?.uuid === asset.uuid;
            const assetValue = parseFiatValue(asset.marketValue);
            return (
              <TouchableOpacity
                key={asset.uuid}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                style={styles.assetRow}
                onPress={() => selectAsset(asset)}
                activeOpacity={0.7}
              >
                <View style={styles.assetRowLeft}>
                  {getAssetIcon(asset, isSelected)}
                  <Text style={[styles.assetSymbol, isSelected && styles.assetTextSelected]}>{asset.symbol}</Text>
                </View>
                <View style={styles.assetRowRight}>
                  {asset.isNative && (
                    <>
                      <Text style={styles.assetBalance}>{formatCryptoBalance(asset.balance, asset.symbol)}</Text>
                      <Text style={styles.assetSeparator}>&middot;</Text>
                    </>
                  )}
                  <Text style={[styles.assetFiat, isSelected && styles.assetTextSelected]}>
                    {assetValue === null ? 'Unpriced' : formatDisplayCurrency(assetValue)}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </Rows>
      ) : null}

      {selectedAsset && (
        <>
          <View style={styles.inputSection}>
            <View style={styles.labelRow}>
              <Text style={styles.inputLabel}>Destination Address</Text>
              <TouchableOpacity onPress={onOpenAddressScanner} style={styles.scanButton}>
                <QrCodeIcon
                  size={theme.icon.sizes.md}
                  color={theme.colors.interactive.active}
                  weight={theme.icon.weights.regular}
                />
                <Text style={styles.scanButtonText}>Scan QR</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={text.field}
              value={toAddress}
              onChangeText={setToAddress}
              placeholder={getAddressPlaceholder(chainShortName)}
              placeholderTextColor={theme.colors.text.muted}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={styles.inputSection}>
            <View style={styles.labelRow}>
              <Text style={styles.inputLabel}>Amount ({assetSymbol})</Text>
              <TouchableOpacity onPress={useMaxAmount}>
                <Text style={styles.useMaxLink}>Use Max</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={text.field}
              value={amount}
              onChangeText={setAmount}
              placeholder="0.0"
              placeholderTextColor={theme.colors.text.muted}
              keyboardType="decimal-pad"
            />
            {marketValue === null && <Text style={styles.fiatEstimate}>Unpriced: no fiat estimate available.</Text>}
            {fiatEstimate !== null && <Text style={styles.fiatEstimate}>≈ {formatDisplayCurrency(fiatEstimate)}</Text>}
            {!selectedAsset.isNative && <Text style={styles.gasWarningText}>Note: ETH is required for gas fees</Text>}
          </View>
        </>
      )}
    </ScrollView>
  );
}
