import React from 'react';
import { View, Text, TextInput, ActivityIndicator } from 'react-native';
import { useOrderActionSigning, type OrderAction, type Wallet } from '@ledova/shared';
import { Action } from '../../../components/Ledger';
import { CustomModal, useDialogStyles } from '../../../components/modal';
import { QRDisplay, QRScanner } from '../../../components/qr';
import { useAppTheme, useThemedStyles } from '../../../contexts';
import { getSeedPhrase } from '../../../services/secureKeyStorage';
import { signEthereumTypedData } from '../../../utils/softwareWallet/localSigner';
import { encodeEthereumTypedData } from '../../../utils/keystone/urEncoder';
import { decodeKeystoneMessageSignature } from '../../../utils/keystone/urDecoder';
import { marketAmount } from '../marketData';

interface Props {
  action: OrderAction;
  wallets: Wallet[];
  onClose: () => void;
}

export function OrderActionModal({ action, wallets, onClose }: Props) {
  const theme = useAppTheme();
  const text = useDialogStyles();
  const styles = useThemedStyles((theme) => ({
    content: { gap: theme.spacing.md },
    group: { gap: theme.spacing.xs },
    replacements: {
      gap: theme.spacing.xs,
      paddingTop: theme.spacing.smd,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border.subtle,
    },
  }));
  const signing = useOrderActionSigning(action, wallets, (message, wallet) => {
    const encoded = encodeEthereumTypedData(
      wallet.address,
      { domain: message.domain, types: message.types, message: message.message },
      wallet.derivationPath || undefined,
      wallet.masterFingerprint || undefined,
      message.domain.chainId,
    );
    return encoded ? { cborHex: encoded.cbor.toString('hex'), type: encoded.type } : null;
  });
  const { state, view, wallet } = signing;
  const label = action.purpose === 'cancel' ? 'cancellation' : 'change';
  const review = state.snapshot?.review ?? state.context;
  const replacements = state.snapshot?.intent.modifications;
  const close = () => {
    signing.close();
    onClose();
  };
  const confirm = () => {
    if (state.phase === 'error') {
      void action.recover();
      return;
    }
    if (state.phase === 'editing') {
      void action.prepare();
      return;
    }
    if (view.step === 'show-qr') {
      signing.scan();
      return;
    }
    if (wallet?.signingPreference !== 'software') {
      signing.showQr();
      return;
    }
    void signing.sign(async (message, current) => {
      if (!wallet.derivationPath || !wallet.masterFingerprint)
        throw new Error('This wallet is missing its local signing key.');
      if (!current()) return null;
      const mnemonic = await getSeedPhrase(wallet.masterFingerprint);
      if (!mnemonic || !current()) return null;
      return signEthereumTypedData(mnemonic, wallet.derivationPath, message.domain, message.types, message.message);
    });
  };
  const canConfirm =
    ['editing', 'error'].includes(state.phase) ||
    (state.phase === 'ready' && ['instructions', 'show-qr'].includes(view.step));
  const confirmLabel =
    state.phase === 'editing'
      ? `Review ${label}`
      : state.phase === 'error'
        ? action.record
          ? `Check ${label} status`
          : 'Retry order details'
        : view.step === 'show-qr'
          ? "I've signed it"
          : wallet?.signingPreference === 'software'
            ? 'Sign with biometric'
            : 'Show signing code';
  return (
    <>
      <CustomModal
        key={canConfirm ? 'confirmable' : 'status'}
        visible={!(state.phase === 'ready' && view.step === 'scan-signature')}
        title={action.purpose === 'cancel' ? 'Cancel order' : 'Change order'}
        onClose={close}
        showFooter
        showCancelButton
        cancelLabel={['applied', 'refused'].includes(state.phase) ? 'Done' : 'Close'}
        onCancel={close}
        onConfirm={canConfirm ? confirm : undefined}
        confirmDisabled={state.phase === 'ready' && !signing.walletReady}
        confirmLabel={confirmLabel}
        actions={
          state.phase === 'error' && state.canRemoveReminder ? (
            <Action label="Remove saved reminder" onPress={() => void action.removeReminder()} />
          ) : undefined
        }
      >
        <View style={styles.content}>
          {['loading', 'preparing', 'signing', 'submitting'].includes(state.phase) && (
            <ActivityIndicator color={theme.colors.interactive.default} />
          )}
          {state.phase === 'loading' && <Text style={text.text}>Loading current order details...</Text>}
          {state.phase === 'preparing' && (
            <Text style={text.text}>Checking this {label} and preparing signing details...</Text>
          )}
          {state.phase === 'signing' && <Text style={text.text}>Authenticating and signing this {label}...</Text>}
          {state.phase === 'submitting' && (
            <Text style={text.text}>Submitting this {label}. You can close and check its saved status later.</Text>
          )}
          {review && (
            <View style={styles.group}>
              <Text style={text.text}>
                Token: {review.token.symbol} — {review.token.name}
              </Text>
              <Text style={text.text}>Wallet: {state.snapshot?.walletAddress ?? state.context?.walletAddress}</Text>
              <Text style={text.text}>Reviewed quantity: {review.currentValues.quantity} shares</Text>
              <Text style={text.text}>Reviewed minimum: {review.currentValues.minQuantity} shares</Text>
              <Text style={text.text}>
                Reviewed price per share: {marketAmount(review.currentValues.pricePerShare)}
              </Text>
              <Text style={text.text}>Filled: {review.currentValues.filledQuantity} shares</Text>
            </View>
          )}
          {state.phase === 'editing' && (
            <>
              {action.purpose === 'cancel' ? (
                <Text style={text.text}>Cancel the available remainder of this order.</Text>
              ) : (
                <>
                  <View style={styles.group}>
                    <Text style={text.text}>New quantity</Text>
                    <TextInput
                      accessibilityLabel="New quantity"
                      keyboardType="number-pad"
                      style={text.field}
                      value={state.values?.quantity ?? ''}
                      onChangeText={(value) => action.edit('quantity', value)}
                    />
                  </View>
                  <View style={styles.group}>
                    <Text style={text.text}>New minimum fill</Text>
                    <TextInput
                      accessibilityLabel="New minimum fill"
                      keyboardType="number-pad"
                      style={text.field}
                      value={state.values?.minQuantity ?? ''}
                      onChangeText={(value) => action.edit('minQuantity', value)}
                    />
                  </View>
                  <View style={styles.group}>
                    <Text style={text.text}>New price per share</Text>
                    <TextInput
                      accessibilityLabel="New price per share"
                      keyboardType="decimal-pad"
                      style={text.field}
                      value={state.values?.pricePerShare ?? ''}
                      onChangeText={(value) => action.edit('pricePerShare', value)}
                    />
                  </View>
                </>
              )}
              {state.error && (
                <Text accessibilityRole="alert" style={text.error}>
                  {state.error}
                </Text>
              )}
            </>
          )}
          {replacements && (
            <View style={styles.replacements}>
              <Text style={text.text}>New quantity: {replacements.quantity} shares</Text>
              <Text style={text.text}>New minimum fill: {replacements.minQuantity} shares</Text>
              <Text style={text.text}>New price per share: {marketAmount(replacements.pricePerShare)}</Text>
            </View>
          )}
          {state.phase === 'ready' && (
            <>
              {!signing.walletReady && (
                <Text style={text.text}>
                  This exact wallet is unavailable for signing in the current account. The saved action remains
                  available to check.
                </Text>
              )}
              {view.error && (
                <Text accessibilityRole="alert" style={text.error}>
                  {view.error}
                </Text>
              )}
              {view.step === 'show-qr' && view.qrData && <QRDisplay data={view.qrData.cborHex} isUR />}
            </>
          )}
          {state.phase === 'applied' && (
            <View style={styles.group}>
              <Text accessibilityRole="header" style={text.heading}>
                {state.recovered ? 'Original action recovered' : 'Action recorded'}
              </Text>
              {state.snapshot?.result?.kind === 'cancel' && (
                <Text style={text.text}>
                  This cancellation changed the order from {state.snapshot.result.fromStatus} to cancelled.
                </Text>
              )}
              {state.snapshot?.result?.kind === 'modify' && (
                <>
                  <Text style={text.text}>This change is modification {state.snapshot.result.modificationCount}.</Text>
                  {state.snapshot.result.changes.length === 0 && (
                    <Text style={text.text}>The values were already the requested values.</Text>
                  )}
                  {state.snapshot.result.changes.map((change) => (
                    <Text key={change.field} style={text.text}>
                      {change.field.replaceAll('_', ' ')}: {change.old} → {change.new}
                    </Text>
                  ))}
                </>
              )}
              <Text style={text.text}>
                Current order status:{' '}
                {state.snapshot?.order.statusDisplay ?? state.snapshot?.order.status.replaceAll('_', ' ')}
              </Text>
            </View>
          )}
          {state.phase === 'refused' && (
            <View style={styles.group}>
              <Text accessibilityRole="header" style={text.heading}>
                {action.purpose === 'cancel' ? 'Cancellation declined' : 'Change declined'}
              </Text>
              <Text style={text.text}>{state.snapshot?.refusal?.detail}</Text>
              <Text style={text.text}>This is the recorded result of the original request.</Text>
            </View>
          )}
          {state.phase === 'error' && (
            <View style={styles.group}>
              <Text accessibilityRole="header" style={text.heading}>
                {state.canRemoveReminder
                  ? 'Signing request rejected'
                  : action.record
                    ? 'Action status unconfirmed'
                    : 'Order details unavailable'}
              </Text>
              <Text accessibilityRole="alert" style={text.error}>
                {state.error}
              </Text>
              {action.record && !state.canRemoveReminder && (
                <Text style={text.text}>
                  Check the saved action before signing again. An unavailable result does not start a replacement
                  action.
                </Text>
              )}
              {state.canRemoveReminder && (
                <Text style={text.text}>Removing this reminder does not cancel an action you already submitted.</Text>
              )}
            </View>
          )}
          {state.notice && <Text style={text.text}>{state.notice}</Text>}
        </View>
      </CustomModal>
      <QRScanner
        visible={state.phase === 'ready' && view.step === 'scan-signature'}
        onClose={signing.back}
        onScan={(text) => {
          const signature = decodeKeystoneMessageSignature(text);
          if (signature) void signing.submitSignature(signature);
        }}
        title="Scan action signature"
        subtitle="Scan the signature for the cancellation or change you just reviewed."
      />
    </>
  );
}
