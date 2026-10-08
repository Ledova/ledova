import { useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { Wallet, DerivedAddress } from '@ledova/shared';
import {
  WALLET_VERIFICATION_STATUS,
  getWalletSigningPreferenceLabel,
  canDeriveNextWalletAddress,
  getChainShortCode,
  getBlockchainDisplayName,
  formatCryptoBalance,
  formatDate,
  getErrorMessage,
  getNativeAssetSymbol,
  useCurrency,
} from '@ledova/shared';
import type { WalletsStackParamList } from '../../../navigation/WalletsStackNavigator';
import { Section, Row, Rows, Action } from '../../../components/Ledger';
import { DeleteWalletModal } from './DeleteWalletModal';
import { DeriveAddressModal } from './DeriveAddressModal';
import { useWalletsCrud } from '../useWalletsCrud';
import { WalletsPage, useWalletStyles } from '../WalletsPage';
import { assertSessionEpoch, getSessionEpoch } from '../../../services/sessionScope';

export function WalletActionScreen() {
  const route = useRoute<RouteProp<WalletsStackParamList, 'WalletAction'>>();
  return <WalletDetails key={route.params.wallet.uuid} uuid={route.params.wallet.uuid} />;
}

function WalletDetails({ uuid }: { uuid: string }) {
  const navigation = useNavigation<NativeStackNavigationProp<WalletsStackParamList>>();
  const styles = useWalletStyles();
  const crud = useWalletsCrud();
  const { formatDisplayCurrency } = useCurrency();
  const wallet = crud.wallets.find((item) => item.uuid === uuid);
  const [name, setName] = useState<string | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [deriving, setDeriving] = useState<Wallet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const blocked = crud.isLoading || crud.isRefreshing || crud.hasError || !wallet;
  const isVerified = wallet?.verificationStatus === WALLET_VERIFICATION_STATUS.VERIFIED;
  const canDerive = !!wallet && isVerified && canDeriveNextWalletAddress(wallet, crud.wallets);
  const walletName = name ?? wallet?.name ?? '';
  const canSave = isVerified && !blocked && !pending && walletName.trim() !== (wallet?.name ?? '');
  const run = async (write: () => Promise<unknown>, completed?: () => void) => {
    if (pendingRef.current || blocked) return;
    const epoch = getSessionEpoch();
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      await write();
      assertSessionEpoch(epoch);
      completed?.();
    } catch (failure) {
      if (epoch === getSessionEpoch())
        setError(getErrorMessage(failure, 'This wallet could not be saved. Your changes are kept; try again.'));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };
  const back = () => {
    if (navigation.isFocused() && navigation.canGoBack()) navigation.goBack();
  };
  const derive = (address: DerivedAddress) => {
    if (!wallet || !canDerive) return;
    void run(
      () =>
        crud.createWallet({
          address: address.address,
          chain: wallet.chain,
          signingPreference: wallet.signingPreference ?? undefined,
          derivationPath: address.derivationPath,
          masterFingerprint: wallet.masterFingerprint,
          addressIndex: address.addressIndex,
          parentPublicKey: wallet.parentPublicKey,
          parentChainCode: wallet.parentChainCode,
          parentDerivationPath: wallet.parentDerivationPath,
        }),
      () => setDeriving(null),
    );
  };
  const copy = async () => {
    if (!wallet || blocked) return;
    setCopied(false);
    setCopyError(null);
    try {
      if (!(await Clipboard.setStringAsync(wallet.address))) throw new Error('Clipboard refused');
      setCopied(true);
    } catch {
      setCopyError('The address could not be copied. Try again.');
    }
  };
  return (
    <>
      <WalletsPage
        title="Wallet"
        loading={crud.isLoading}
        refreshing={crud.isRefreshing}
        refresh={() => void crud.refetch()}
      >
        {crud.hasError ? (
          <View style={styles.group}>
            <Text accessibilityRole="alert" style={styles.message}>
              This wallet could not be loaded. Your changes are kept; retry before continuing.
            </Text>
            <Action label="Try again" disabled={crud.isRefreshing} onPress={() => void crud.refetch()} />
          </View>
        ) : !wallet ? (
          <Section title="Not available">
            <Text style={styles.help}>This wallet is no longer in your account.</Text>
          </Section>
        ) : (
          <>
            <Section title={wallet.name || 'Unnamed wallet'}>
              <Rows>
                <Row label="Network">{getBlockchainDisplayName(getChainShortCode(wallet.chain))}</Row>
                <Row label="Address">{wallet.address}</Row>
              </Rows>
              <Action label="Copy address" disabled={blocked} onPress={() => void copy()} />
              {copied && <Text style={styles.help}>Copied address</Text>}
              {copyError && (
                <Text accessibilityRole="alert" style={styles.message}>
                  {copyError}
                </Text>
              )}
              <Rows>
                <Row label="Balance">
                  {formatCryptoBalance(wallet.nativeBalance, getNativeAssetSymbol(wallet.chain))}
                </Row>
                <Row label="Estimated value">{formatDisplayCurrency(Number(wallet.marketValue))}</Row>
                <Row label="Signing preference">{getWalletSigningPreferenceLabel(wallet.signingPreference)}</Row>
                <Row label="Verification">{isVerified ? 'Address verified' : 'Pending'}</Row>
                <Row label="Last synced">{formatDate(wallet.lastSyncedAt)}</Row>
              </Rows>
            </Section>
            <Section title="Wallet name">
              <TextInput
                accessibilityLabel="Wallet name"
                value={walletName}
                onChangeText={setName}
                maxLength={100}
                editable={isVerified && !pending}
                placeholder="Name this wallet"
                style={styles.input}
              />
              <Text style={styles.help}>
                {isVerified
                  ? 'Give this verified address a memorable name.'
                  : 'Verify the address before changing its name.'}
              </Text>
              <Action
                label={pending ? 'Saving…' : 'Save name'}
                onPress={() => {
                  if (canSave)
                    void run(
                      () => crud.updateWallet(wallet.uuid, walletName.trim()),
                      () => setName(null),
                    );
                }}
                disabled={!canSave}
                primary
              />
            </Section>
            {error && !showDelete && !deriving && (
              <Text accessibilityRole="alert" style={styles.message}>
                {error}
              </Text>
            )}
            <Section title="Actions">
              <View style={styles.actions}>
                <Action
                  label={isVerified ? 'Refresh possession proof' : 'Verify address'}
                  onPress={() => navigation.navigate('WalletVerification', { wallet })}
                  disabled={blocked || pending}
                />
                <Action
                  label={crud.syncingWalletIds.has(wallet.uuid) ? 'Syncing…' : 'Sync balances'}
                  onPress={() => {
                    if (!blocked) void crud.syncWallet(wallet.uuid).catch(() => undefined);
                  }}
                  disabled={blocked || pending || crud.syncingWalletIds.has(wallet.uuid)}
                />
                <Action
                  label="Derive address"
                  onPress={() => {
                    setError(null);
                    setDeriving(wallet);
                  }}
                  disabled={blocked || pending || !canDerive}
                />
                <Action
                  label="Delete wallet"
                  onPress={() => {
                    setError(null);
                    setShowDelete(true);
                  }}
                  disabled={blocked || pending}
                />
              </View>
            </Section>
          </>
        )}
      </WalletsPage>
      <DeleteWalletModal
        visible={showDelete}
        walletName={wallet?.name || 'this wallet'}
        pending={pending}
        blocked={blocked}
        error={error}
        onRetry={() => void crud.refetch()}
        onConfirm={() =>
          void run(
            () => crud.deleteWallet(uuid),
            () => {
              setShowDelete(false);
              back();
            },
          )
        }
        onClose={() => {
          if (!pendingRef.current) setShowDelete(false);
        }}
      />
      <DeriveAddressModal
        visible={!!deriving}
        wallet={deriving ? (wallet ?? deriving) : null}
        isCreating={pending}
        blocked={blocked || !canDerive}
        createError={error}
        onRetry={() => void crud.refetch()}
        onConfirm={derive}
        onClose={() => {
          if (!pendingRef.current) setDeriving(null);
        }}
      />
    </>
  );
}
