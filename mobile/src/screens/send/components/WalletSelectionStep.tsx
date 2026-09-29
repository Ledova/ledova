import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { WalletIcon, CheckCircleIcon, ClockIcon, CurrencyEthIcon, CurrencyBtcIcon } from 'phosphor-react-native';
import {
  BLOCKCHAIN,
  WALLET_VERIFICATION_STATUS,
  formatWalletAddressShort,
  formatCryptoBalance,
  formatSyncAge,
  useCurrency,
} from '@ledova/shared';
import type { Wallet } from '@ledova/shared';
import { useAppTheme, useThemedStyles } from '../../../contexts';
import { useDialogStyles } from '../../../components/modal';

interface WalletSelectionStepProps {
  wallets: Wallet[];
  isLoading: boolean;
  onSelectWallet: (wallet: Wallet) => void;
}

export function WalletSelectionStep({ wallets, isLoading, onSelectWallet }: WalletSelectionStepProps) {
  const theme = useAppTheme();
  const { formatDisplayCurrency } = useCurrency();
  const text = useDialogStyles();
  const styles = useThemedStyles((theme) => ({
    container: {
      gap: theme.spacing.md,
    },
    loading: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    emptySubtitle: {
      fontFamily: theme.fontFamily.regular,
      fontSize: theme.fontSize.xs,
      color: theme.colors.text.subtle,
    },
    chainGroup: {
      gap: theme.spacing.xs,
    },
    divider: {
      height: 1,
      backgroundColor: theme.colors.border.subtle,
    },
    chainHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    chainHeader: {
      fontSize: theme.fontSize.sm,
      fontWeight: theme.fontWeight.semibold,
      color: theme.colors.text.primary,
    },
    walletRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: theme.spacing.sm,
      gap: theme.spacing.sm,
    },
    iconContainer: {
      position: 'relative',
    },
    verificationDot: {
      position: 'absolute',
      bottom: -2,
      right: -2,
    },
    walletName: {
      fontSize: theme.fontSize.xs,
      color: theme.colors.text.muted,
      flexShrink: 1,
    },
    spacer: {
      flex: 1,
    },
    valuesContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      flexShrink: 0,
    },
    syncAge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.xs,
    },
    syncAgeText: {
      fontSize: theme.fontSize.xs,
      color: theme.colors.text.subtle,
    },
    balance: {
      fontSize: theme.fontSize.xs,
      color: theme.colors.text.muted,
    },
    marketValue: {
      fontSize: theme.fontSize.xs,
      color: theme.colors.text.muted,
    },
  }));

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="small" color={theme.colors.interactive.active} />
        <Text style={text.muted}>Loading wallets...</Text>
      </View>
    );
  }

  if (wallets.length === 0) {
    return (
      <View style={text.group}>
        <Text style={text.muted}>No verified wallets found</Text>
        <Text style={styles.emptySubtitle}>Create and verify a wallet to send crypto</Text>
      </View>
    );
  }

  const ethWallets = wallets.filter((w) => w.chain === BLOCKCHAIN.ETHEREUM);
  const baseWallets = wallets.filter((w) => w.chain === BLOCKCHAIN.BASE);
  const btcWallets = wallets.filter((w) => w.chain === BLOCKCHAIN.BITCOIN);

  const renderWallet = (wallet: Wallet) => {
    const walletLabel = wallet.name || formatWalletAddressShort(wallet.address);
    const isVerified = wallet.verificationStatus === WALLET_VERIFICATION_STATUS.VERIFIED;
    const marketValue = parseFloat(wallet.marketValue) || 0;
    const syncAge = formatSyncAge(wallet.lastSyncedAt);

    return (
      <TouchableOpacity
        key={wallet.uuid}
        style={styles.walletRow}
        onPress={() => onSelectWallet(wallet)}
        activeOpacity={0.7}
      >
        <View style={styles.iconContainer}>
          <WalletIcon
            size={theme.icon.sizes.md}
            color={isVerified ? theme.colors.status.success.icon : theme.colors.text.muted}
            weight={theme.icon.weights.regular}
          />
          {isVerified ? (
            <CheckCircleIcon
              size={theme.icon.sizes.xs}
              color={theme.colors.status.success.icon}
              weight="fill"
              style={styles.verificationDot}
            />
          ) : (
            <ClockIcon
              size={theme.icon.sizes.xs}
              color={theme.colors.status.warning.icon}
              weight="fill"
              style={styles.verificationDot}
            />
          )}
        </View>

        <Text style={styles.walletName} numberOfLines={1}>
          {walletLabel}
        </Text>

        <View style={styles.spacer} />

        <View style={styles.valuesContainer}>
          {syncAge && (
            <View style={styles.syncAge}>
              <ClockIcon size={theme.icon.sizes.xs} color={theme.colors.text.subtle} weight="regular" />
              <Text style={styles.syncAgeText}>{syncAge}</Text>
            </View>
          )}
          <Text style={styles.balance} numberOfLines={1}>
            {formatCryptoBalance(wallet.nativeBalance, '').trimEnd()}
          </Text>
          <Text style={styles.marketValue}>{formatDisplayCurrency(marketValue)}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {[
        { key: 'ethereum', label: 'Ethereum', icon: CurrencyEthIcon, wallets: ethWallets },
        { key: 'base', label: 'Base', icon: CurrencyEthIcon, wallets: baseWallets },
        { key: 'bitcoin', label: 'Bitcoin', icon: CurrencyBtcIcon, wallets: btcWallets },
      ]
        .filter((group) => group.wallets.length > 0)
        .map((group, index) => (
          <React.Fragment key={group.key}>
            {index > 0 && <View style={styles.divider} />}
            <View style={styles.chainGroup}>
              <View style={styles.chainHeaderRow}>
                <group.icon size={theme.icon.sizes.md} color={theme.colors.text.muted} weight="bold" />
                <Text style={styles.chainHeader}>{group.label}</Text>
              </View>
              {group.wallets.map(renderWallet)}
            </View>
          </React.Fragment>
        ))}
    </View>
  );
}
