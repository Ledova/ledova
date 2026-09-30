import { useState } from 'react';
import { Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { getActiveChains } from '@ledova/shared';
import type { WalletsStackParamList } from '../../navigation/WalletsStackNavigator';
import { Section, Action } from '../../components/Ledger';
import { WalletSort, WalletSummary, sortWallets, useWalletSort } from '../../components/wallet-list';
import { AddWalletModal } from './components/AddWalletModal';
import { CryptoActions } from './components/CryptoActions';
import { useWallets } from './useWallets';
import { useWalletsCrud } from './useWalletsCrud';
import { WalletsPage, useWalletStyles } from './WalletsPage';

export function WalletsScreen() {
  const styles = useWalletStyles();
  const navigation = useNavigation<NativeStackNavigationProp<WalletsStackParamList>>();
  const crud = useWalletsCrud();
  const form = useWallets(crud);
  const [syncingAll, setSyncingAll] = useState(false);
  const sort = useWalletSort();
  const blocked = crud.isLoading || crud.hasError || crud.isRefreshing;
  const notice = crud.hasError
    ? 'Wallets could not be refreshed. Your draft is kept; retry before continuing.'
    : blocked
      ? 'Refreshing wallets before continuing…'
      : null;
  const syncAll = async () => {
    if (blocked || syncingAll) return;
    setSyncingAll(true);
    try {
      await Promise.allSettled(crud.wallets.map((wallet) => crud.syncWallet(wallet.uuid)));
    } finally {
      setSyncingAll(false);
    }
  };
  return (
    <>
      <WalletsPage
        lede="Open a wallet to verify, rename, derive another address or sync its balances."
        actions={
          !crud.isLoading && (
            <>
              <CryptoActions wallets={crud.hasError || !crud.isSettled ? null : crud.wallets} />
              <Action label="Add wallet" onPress={form.openAddModal} disabled={blocked} primary />
              <Action
                label={syncingAll ? 'Syncing wallets…' : 'Sync balances'}
                onPress={() => void syncAll()}
                disabled={blocked || syncingAll || !crud.wallets.length}
              />
            </>
          )
        }
        loading={crud.isLoading}
        refreshing={crud.isRefreshing}
        refresh={() => void crud.refetch()}
      >
        {crud.hasError ? (
          <View style={styles.group}>
            <Text accessibilityRole="alert" style={styles.message}>
              Your wallets could not be loaded. Try again before continuing.
            </Text>
            <Action label="Try again" onPress={() => void crud.refetch()} disabled={crud.isRefreshing} />
          </View>
        ) : (
          getActiveChains().map(({ code, name }) => {
            const wallets = sortWallets(
              crud.wallets.filter((wallet) => wallet.chain === code),
              sort.sortOf(code),
            );
            return (
              <Section key={code} title={name}>
                {wallets.length > 1 && (
                  <WalletSort
                    open={sort.isOpen(code)}
                    sort={sort.sortOf(code)}
                    onToggle={() => sort.toggle(code)}
                    onSort={(option) => sort.choose(code, option)}
                  />
                )}
                {wallets.length ? (
                  wallets.map((wallet, index) => (
                    <View key={wallet.uuid} style={[styles.item, index === wallets.length - 1 && styles.lastItem]}>
                      <WalletSummary wallet={wallet} />
                      <Action
                        label="Open wallet"
                        accessibilityLabel={`Open wallet ${wallet.name || wallet.address}`}
                        onPress={() => navigation.navigate('WalletAction', { wallet })}
                        disabled={blocked}
                      />
                    </View>
                  ))
                ) : (
                  <Text style={styles.help}>No {name} wallets yet.</Text>
                )}
              </Section>
            );
          })
        )}
      </WalletsPage>
      <AddWalletModal
        visible={form.showAddModal}
        isLoading={form.isCreating}
        readBlocked={blocked}
        notice={notice}
        error={form.createError}
        onRetry={() => void crud.refetch()}
        onClose={form.closeAddModal}
        onSubmit={form.handleCreateWallet}
        onBatchSubmit={form.handleBatchCreateWallets}
        onSoftwareWalletCreate={form.handleSoftwareWalletCreate}
      />
    </>
  );
}
