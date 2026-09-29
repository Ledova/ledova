import React from 'react';
import { View, Text, ActivityIndicator, ScrollView } from 'react-native';
import { CurrencyEthIcon, CurrencyBtcIcon } from 'phosphor-react-native';
import { BLOCKCHAIN } from '@ledova/shared';
import type { Wallet } from '@ledova/shared';
import { useAppTheme, useThemedStyles } from '../../../contexts';
import { useDialogStyles } from '../../../components/modal';
import { Rows } from '../../../components/Ledger';
import { WalletChoice } from '../../../components/wallet-list';

interface WalletSelectionStepProps {
  wallets: Wallet[];
  isLoading: boolean;
  onSelectWallet: (wallet: Wallet) => void;
}

export function WalletSelectionStep({ wallets, isLoading, onSelectWallet }: WalletSelectionStepProps) {
  const theme = useAppTheme();
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

  return (
    <ScrollView contentContainerStyle={styles.container}>
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
              <Rows>
                {group.wallets.map((wallet) => (
                  <WalletChoice key={wallet.uuid} wallet={wallet} onChoose={() => onSelectWallet(wallet)} />
                ))}
              </Rows>
            </View>
          </React.Fragment>
        ))}
    </ScrollView>
  );
}
