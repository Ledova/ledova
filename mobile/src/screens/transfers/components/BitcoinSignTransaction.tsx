import React from 'react';
import { View, Text, TextInput, ScrollView } from 'react-native';
import { useAppTheme, useThemedStyles } from '../../../contexts';
import { Row, Rows } from '../../../components/Ledger';
import { useDialogStyles } from '../../../components/modal';
import { formatWalletAddressShort } from '@ledova/shared';
import type { TransactionData } from '@ledova/shared';

interface BitcoinSignTransactionProps {
  transactionData: TransactionData;
  signedHex: string;
  onChangeSignedHex: (value: string) => void;
  error: string | null;
}

const INSTRUCTIONS = [
  'In your own Bitcoin wallet software, build a transaction from this address that pays the amount below to the recipient at the fee rate shown.',
  'Sign it there and export the signed raw transaction as hex.',
  'Paste the signed hex below and tap Broadcast.',
];

export function BitcoinSignTransaction({
  transactionData,
  signedHex,
  onChangeSignedHex,
  error,
}: BitcoinSignTransactionProps) {
  const theme = useAppTheme();
  const text = useDialogStyles();
  const styles = useThemedStyles((theme) => ({
    scrollContent: {
      flex: 1,
    },
    scrollContentContainer: {
      gap: theme.spacing.md,
    },
    steps: {
      gap: theme.spacing.sm,
    },
    input: {
      fontSize: theme.fontSize.sm,
      fontFamily: theme.fontFamily.mono,
      minHeight: 120,
      textAlignVertical: 'top',
    },
  }));

  return (
    <ScrollView
      style={styles.scrollContent}
      contentContainerStyle={styles.scrollContentContainer}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={text.muted}>
        This app does not build or sign Bitcoin transactions. Sign with your own wallet software and paste the result.
      </Text>

      <View style={text.group}>
        <Text accessibilityRole="header" style={text.heading}>
          What to sign
        </Text>
        <Rows>
          <Row label="From" mono>
            {formatWalletAddressShort(transactionData.fromAddress)}
          </Row>
          <Row label="To" mono>
            {formatWalletAddressShort(transactionData.toAddress)}
          </Row>
          <Row label="Amount" mono>
            {transactionData.amountBtc} BTC
          </Row>
          <Row label="Fee Rate" mono>
            {transactionData.feePerByte} sat/vB
          </Row>
          <Row label="Estimated Size" mono>
            {transactionData.estimatedTxSize} vB
          </Row>
          <Row label="Total" mono>
            {transactionData.totalCostBtc} BTC
          </Row>
        </Rows>
      </View>

      <View style={styles.steps}>
        {INSTRUCTIONS.map((instruction, index) => (
          <Text key={instruction} style={text.muted}>
            {index + 1}. {instruction}
          </Text>
        ))}
      </View>

      <View style={text.group}>
        <Text accessibilityRole="header" style={text.heading}>
          Signed transaction (hex)
        </Text>
        <TextInput
          style={[text.field, styles.input]}
          value={signedHex}
          onChangeText={onChangeSignedHex}
          placeholder="02000000..."
          placeholderTextColor={theme.colors.text.muted}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
        />
        {error && <Text style={text.error}>{error}</Text>}
      </View>
    </ScrollView>
  );
}
