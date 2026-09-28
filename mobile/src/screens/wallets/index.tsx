import { useState } from 'react';
import { Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BLOCKCHAIN, WALLET_VERIFICATION_STATUS, getChainShortCode } from '@ledova/shared';
import type { WalletsStackParamList } from '../../navigation/WalletsStackNavigator';
import { Section, Row, Action } from '../../components/Ledger';
import { WalletSortModal, useWalletSort } from '../../components/wallet-list';
import { AddWalletModal } from './components/AddWalletModal';
import { CryptoActions } from './components/CryptoActions';
import { useWallets } from './useWallets';
import { useWalletsCrud } from './useWalletsCrud';
import { WalletsPage, useWalletStyles } from './WalletsPage';
import { walletBalance } from './presentation';
import { useCurrency } from '../../hooks/useCurrency';

export function WalletsScreen() {
  const styles = useWalletStyles();
  const navigation = useNavigation<NativeStackNavigationProp<WalletsStackParamList>>();
  const crud = useWalletsCrud();
  const form = useWallets(crud);
  const { formatDisplayCurrency } = useCurrency();
  const [syncingAll, setSyncingAll] = useState(false);
  const { sortedWallets, chainFilter, sortOption, isFiltered, showSortModal, setShowSortModal, handleApply } =
    useWalletSort(crud.wallets);
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
      <WalletsPage loading={crud.isLoading} refreshing={crud.isRefreshing} refresh={() => void crud.refetch()}>
        <Text style={styles.help}>
          Your addresses for receiving shares and managing test crypto. Open a wallet to verify, rename, derive another
          address or sync its balances.
        </Text>
        <CryptoActions />
        <View style={styles.actions}>
          <Action label="Add wallet" onPress={form.openAddModal} disabled={blocked} primary />
          <Action label={isFiltered ? 'Filter (active)' : 'Filter'} onPress={() => setShowSortModal(true)} />
          <Action
            label={syncingAll ? 'Syncing wallets…' : 'Sync balances'}
            onPress={() => void syncAll()}
            disabled={blocked || syncingAll || !crud.wallets.length}
          />
        </View>
        {crud.hasError ? (
          <View style={styles.group}>
            <Text accessibilityRole="alert" style={styles.message}>
              Your wallets could not be loaded. Try again before continuing.
            </Text>
            <Action label="Try again" onPress={() => void crud.refetch()} disabled={crud.isRefreshing} />
          </View>
        ) : (
          <>
            {[
              [BLOCKCHAIN.ETHEREUM, 'Ethereum', 'eth'],
              [BLOCKCHAIN.BITCOIN, 'Bitcoin', 'btc'],
              [BLOCKCHAIN.BASE, 'Base', 'base'],
            ]
              .filter(([, , filter]) => chainFilter === 'all' || chainFilter === filter)
              .map(([chain, name]) => {
                const wallets = sortedWallets.filter((wallet) => wallet.chain === chain);
                return (
                  <Section key={chain} title={name}>
                    {wallets.length ? (
                      wallets.map((wallet) => (
                        <View key={wallet.uuid} style={styles.item}>
                          <Text style={styles.name}>{wallet.name || 'Unnamed wallet'}</Text>
                          <Row label="Address">{wallet.address}</Row>
                          <Row label="Balance">
                            {walletBalance(wallet.nativeBalance)}{' '}
                            {getChainShortCode(wallet.chain) === 'BTC' ? 'BTC' : 'ETH'}
                          </Row>
                          <Row label="Estimated value">{formatDisplayCurrency(Number(wallet.marketValue))}</Row>
                          <Row label="Verification">
                            {wallet.verificationStatus === WALLET_VERIFICATION_STATUS.VERIFIED
                              ? 'Address verified'
                              : 'Pending'}
                          </Row>
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
              })}
          </>
        )}
      </WalletsPage>
      <WalletSortModal
        visible={showSortModal}
        selectedChain={chainFilter}
        selectedSort={sortOption}
        onClose={() => setShowSortModal(false)}
        onApply={handleApply}
      />
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
