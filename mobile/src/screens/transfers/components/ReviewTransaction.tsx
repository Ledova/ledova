import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useThemedStyles } from '../../../contexts';
import { Row, Rows } from '../../../components/Ledger';
import { useDialogStyles } from '../../../components/modal';
import { formatWalletAddressMedium, getNativeAssetSymbol, isSupportedEvmChain } from '@ledova/shared';
import type { TransactionData } from '@ledova/shared';

interface ReviewTransactionProps {
  transactionData: TransactionData;
  chainShortName: string;
}

export function ReviewTransaction({ transactionData, chainShortName }: ReviewTransactionProps) {
  const text = useDialogStyles();
  const styles = useThemedStyles((theme) => ({
    scrollContent: {
      flex: 1,
    },
    scrollContentContainer: {
      gap: theme.spacing.md,
    },
    totalSubtext: {
      fontSize: theme.fontSize.xs,
      color: theme.colors.text.muted,
    },
  }));
  const nativeSymbol = getNativeAssetSymbol(chainShortName);
  const isEvm = isSupportedEvmChain(chainShortName);

  return (
    <ScrollView
      style={styles.scrollContent}
      contentContainerStyle={styles.scrollContentContainer}
      showsVerticalScrollIndicator={false}
    >
      <Rows>
        <Row label="From">{formatWalletAddressMedium(transactionData.fromAddress)}</Row>
        <Row label="To">{formatWalletAddressMedium(transactionData.toAddress)}</Row>
        <Row label="Amount">
          {transactionData.amountToken
            ? `${transactionData.amountToken} ${transactionData.tokenSymbol}`
            : `${transactionData.amountEth || transactionData.amountBtc} ${nativeSymbol}`}
        </Row>
        <Row label="Transaction Fee">
          {transactionData.gasCostEth || transactionData.feeBtc} {nativeSymbol}
        </Row>
        <Row label="Total">
          {transactionData.amountToken ? (
            <>
              {transactionData.amountToken} {transactionData.tokenSymbol}
              {'\n'}
              <Text style={styles.totalSubtext}>+ {transactionData.gasCostEth} ETH (gas)</Text>
            </>
          ) : (
            `${transactionData.totalCostEth || transactionData.totalCostBtc} ${nativeSymbol}`
          )}
        </Row>
      </Rows>

      {isEvm && (
        <View style={text.group}>
          <Text accessibilityRole="header" style={text.heading}>
            Chain Details
          </Text>
          <Rows>
            <Row label="Gas Price">{transactionData.gasPriceGwei} Gwei</Row>
            <Row label="Gas Limit">{transactionData.gasLimit}</Row>
          </Rows>
        </View>
      )}

      {transactionData.feePerByte && (
        <View style={text.group}>
          <Text accessibilityRole="header" style={text.heading}>
            Fee Details
          </Text>
          <Rows>
            <Row label="Fee Rate">{transactionData.feePerByte} sat/vB</Row>
            <Row label="Estimated Size">{transactionData.estimatedTxSize} vB</Row>
          </Rows>
        </View>
      )}
    </ScrollView>
  );
}
