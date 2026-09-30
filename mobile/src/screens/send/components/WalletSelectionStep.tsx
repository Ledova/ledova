import React from 'react';
import { View, Text, ActivityIndicator, ScrollView } from 'react-native';
import { CurrencyEthIcon, CurrencyBtcIcon } from 'phosphor-react-native';
import { BLOCKCHAIN, getActiveChains } from '@ledova/shared';
import type { Wallet } from '@ledova/shared';
import { useAppTheme, useThemedStyles } from '../../../contexts';
import { useDialogStyles } from '../../../components/modal';
import { Action, Rows } from '../../../components/Ledger';
import { WalletChoice } from '../../../components/wallet-list';

interface WalletSelectionStepProps {
  wallets: Wallet[];
  isLoading: boolean;
  failed: boolean;
  retrying: boolean;
  onRetry: () => void;
  onSelectWallet: (wallet: Wallet) => void;
}

export function WalletSelectionStep({
  wallets,
  isLoading,
  failed,
  retrying,
  onRetry,
  onSelectWallet,
}: WalletSelectionStepProps) {
  const theme = useAppTheme();
  const text = useDialogStyles();
  const styles = useThemedStyles((theme) => ({
    container: {
      gap: theme.spacing.md,
    },
    failure: {
      gap: theme.spacing.smd,
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

  if (failed) {
    return (
      <View style={styles.failure}>
        <Text accessibilityRole="alert" style={text.muted}>
          Your wallets could not be loaded. Try again before continuing.
        </Text>
        <Action label="Try again" onPress={onRetry} disabled={retrying} />
      </View>
    );
  }

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

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {getActiveChains()
        .map(({ code, name }) => ({ code, name, wallets: wallets.filter((wallet) => wallet.chain === code) }))
        .filter((group) => group.wallets.length > 0)
        .map((group, index) => {
          const ChainIcon = group.code === BLOCKCHAIN.BITCOIN ? CurrencyBtcIcon : CurrencyEthIcon;
          return (
            <React.Fragment key={group.code}>
              {index > 0 && <View style={styles.divider} />}
              <View style={styles.chainGroup}>
                <View style={styles.chainHeaderRow}>
                  <ChainIcon size={theme.icon.sizes.md} color={theme.colors.text.muted} weight="bold" />
                  <Text style={styles.chainHeader}>{group.name}</Text>
                </View>
                <Rows>
                  {group.wallets.map((wallet) => (
                    <WalletChoice key={wallet.uuid} wallet={wallet} onChoose={() => onSelectWallet(wallet)} />
                  ))}
                </Rows>
              </View>
            </React.Fragment>
          );
        })}
    </ScrollView>
  );
}
