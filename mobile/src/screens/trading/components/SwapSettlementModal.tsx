import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { formatUnits } from 'ethers';
import { swapSettlementAdmitted, type SwapSettlement, type Wallet } from '@ledova/shared';
import { Action } from '../../../components/Ledger';
import { CustomModal, useDialogStyles } from '../../../components/modal';
import { QRDisplay, QRScanner } from '../../../components/qr';
import { useAppTheme, useThemedStyles } from '../../../contexts';
import { useSwapSettlementSigning } from '../useSwapSettlementSigning';

interface Props {
  settlement: SwapSettlement;
  wallet: Wallet | null;
  visible?: boolean;
  onClose: () => void;
}

export function SwapSettlementModal({ settlement, wallet, visible = true, onClose }: Props) {
  const theme = useAppTheme();
  const text = useDialogStyles();
  const styles = useThemedStyles((theme) => ({
    content: { gap: theme.spacing.md },
    group: { gap: theme.spacing.xs },
  }));
  const signing = useSwapSettlementSigning(settlement, wallet, visible);
  const { state, view } = signing;
  const response = state.response;
  const context = response?.swapOrder.settlementContext;
  const current = signing.isCurrent();
  const idle = ['ready', 'approval-ready', 'error'].includes(state.phase);
  const admitted = current && response && swapSettlementAdmitted(response);
  const close = () => {
    signing.close();
    onClose();
  };
  const run = (operation: () => Promise<void>) => {
    if (signing.isCurrent()) void operation();
  };
  const approve = state.approvalData?.needsApproval && state.phase === 'approval-ready';
  const allowanceSufficient =
    state.approvalStatus?.needsApproval === false || state.approvalData?.needsApproval === false;
  const canSign = admitted && state.phase === 'ready' && allowanceSufficient;
  const confirm =
    view.step === 'show' ? signing.scan : approve || canSign ? () => void signing.start(!!approve) : undefined;
  return (
    <>
      <CustomModal
        key={current && confirm ? 'confirmable' : 'status'}
        visible={visible && view.step !== 'scan'}
        title="Review settlement"
        onClose={close}
        showFooter
        showCancelButton
        cancelLabel="Close"
        onCancel={close}
        onConfirm={current ? confirm : undefined}
        confirmLabel={view.step === 'show' ? "I've signed it" : approve ? 'Sign token approval' : 'Sign settlement'}
        actions={
          <>
            {view.step === 'show' && view.qr && <Action label="Back to review" onPress={signing.back} />}
            {current && idle && view.step === 'review' && (
              <>
                <Action label="Check settlement status" onPress={() => run(settlement.recover)} />
                {admitted && (
                  <Action label="Check token approval" onPress={() => run(settlement.refreshApprovalStatus)} />
                )}
                {admitted &&
                  state.approvalStatus?.needsApproval &&
                  !state.unconfirmedApprovalHashes.length &&
                  !approve && <Action label="Review token approval" onPress={() => run(settlement.prepareApproval)} />}
              </>
            )}
          </>
        }
      >
        <View style={styles.content}>
          {!current && (
            <Text style={text.text}>This signing view has ended. Close it and check the saved settlement again.</Text>
          )}
          {!idle && <ActivityIndicator color={theme.colors.interactive.default} />}
          {context && response && (
            <View style={styles.group}>
              <Text style={text.text}>
                Token: {context.shareToken.symbol} — {context.shareToken.name}
              </Text>
              <Text style={text.text}>
                Shares: {formatUnits(response.typedData.message.shareAmount, context.shareToken.decimals)}
              </Text>
              <Text style={text.text}>
                Payment:{' '}
                {formatUnits(response.typedData.message.paymentAmount, context.paymentAsset.deploymentDecimals)}{' '}
                {context.paymentAsset.symbol}
              </Text>
              <Text style={text.text}>
                Price per share: {context.pricePerShare} {context.paymentAsset.symbol}
              </Text>
              <Text style={text.text}>Your role: {response.userRole}</Text>
              <Text style={text.text}>Wallet: {context[response.userRole].address}</Text>
              <Text style={text.text}>Seller: {context.seller.address}</Text>
              <Text style={text.text}>Buyer: {context.buyer.address}</Text>
              <Text style={text.text}>Network: {response.typedData.domain.chainId}</Text>
              <Text style={text.text}>Settlement contract: {response.typedData.domain.verifyingContract}</Text>
              <Text style={text.text}>Share token: {context.shareToken.address}</Text>
              <Text style={text.text}>Payment token: {context.paymentAsset.deploymentAddress}</Text>
              <Text style={text.text}>Signing deadline: {response.swapOrder.expiresAt}</Text>
              <Text style={text.text}>Current status: {response.swapOrder.status.replaceAll('_', ' ')}</Text>
              <Text style={text.text}>
                Seller signature: {response.swapOrder.sellerHasSigned ? 'recorded' : 'awaiting'}
              </Text>
              <Text style={text.text}>
                Buyer signature: {response.swapOrder.buyerHasSigned ? 'recorded' : 'awaiting'}
              </Text>
            </View>
          )}
          {approve && state.approvalData?.needsApproval && (
            <View style={styles.group}>
              <Text accessibilityRole="header" style={text.heading}>
                Unlimited token approval
              </Text>
              <Text style={text.text}>Token: {state.approvalData.tokenSymbol}</Text>
              <Text style={text.text}>Spender: {state.approvalData.spender}</Text>
              <Text style={text.text}>
                This permits the settlement contract to spend this token without a fixed allowance limit.
              </Text>
            </View>
          )}
          {state.unconfirmedApprovalHashes.map((hash) => (
            <View key={hash} style={styles.group}>
              <Text style={text.text}>Approval outcome unconfirmed</Text>
              <Text selectable style={text.text}>
                {hash}
              </Text>
            </View>
          ))}
          {state.unconfirmedApprovalHashes.length > 0 && (
            <Text style={text.text}>
              A sufficient allowance can permit signing. It does not confirm these original transactions. No replacement
              approval is sent automatically.
            </Text>
          )}
          {state.approvalResult && !('code' in state.approvalResult) && (
            <Text style={text.text}>Original approval confirmed: {state.approvalResult.txHash}</Text>
          )}
          {state.approvalOutcomes.map((approvalOutcome) => (
            <View key={approvalOutcome.txHash} style={styles.group}>
              <Text style={text.text}>Original approval {approvalOutcome.outcome}.</Text>
              <Text selectable style={text.text}>
                {approvalOutcome.txHash}
              </Text>
              {approvalOutcome.outcome !== 'confirmed' && (
                <Text style={text.text}>This approval took no effect. Review a fresh approval if needed.</Text>
              )}
            </View>
          ))}
          {state.error && (
            <Text accessibilityRole="alert" style={text.error}>
              {state.error}
            </Text>
          )}
          {state.notice && <Text style={text.text}>{state.notice}</Text>}
          {view.error && (
            <Text accessibilityRole="alert" style={text.error}>
              {view.error}
            </Text>
          )}
          {view.step === 'show' && view.qr && (
            <>
              <Text style={text.text}>Scan this signing code with your hardware wallet.</Text>
              <QRDisplay data={view.qr} isUR />
            </>
          )}
          <Text style={text.muted}>
            You can close and check saved settlements later. Signing and sending always require a fresh review.
          </Text>
        </View>
      </CustomModal>
      <QRScanner
        visible={visible && current && view.step === 'scan'}
        onClose={signing.back}
        onScan={(text) => void signing.onScan(text)}
        title={view.approval ? 'Scan approval signature' : 'Scan settlement signature'}
        subtitle="Scan the signature for the exact details you just reviewed."
      />
    </>
  );
}
