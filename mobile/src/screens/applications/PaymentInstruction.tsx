import { useState } from 'react';
import { Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { formatDate, formatMoney, SUBSCRIPTION_COPY, type PaymentInstruction as Instruction } from '@ledova/shared';
import { Action, Row, Rows, Section } from '../../components/Ledger';
import { useApplicationStyles } from './ApplicationsPage';

function InstructionRow({
  label,
  value,
  display,
  copyable = false,
}: {
  label: string;
  value?: string;
  display?: string;
  copyable?: boolean;
}) {
  const styles = useApplicationStyles();
  const [result, setResult] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    if (!value) return;
    try {
      const copied = await Clipboard.setStringAsync(value);
      setResult(copied ? 'copied' : 'failed');
    } catch {
      setResult('failed');
    }
  };
  return (
    <View style={styles.group}>
      <Row label={label}>{display ?? value ?? 'Unavailable'}</Row>
      {copyable && value && <Action label={`Copy ${label.toLowerCase()}`} onPress={() => void copy()} />}
      {result === 'copied' && (
        <Text accessibilityRole="alert" style={styles.help}>
          Copied {label.toLowerCase()}
        </Text>
      )}
      {result === 'failed' && (
        <Text accessibilityRole="alert" style={styles.message}>
          Could not copy {label.toLowerCase()}. Please try again.
        </Text>
      )}
    </View>
  );
}

export function PaymentInstruction({
  instruction,
  paymentRecorded,
}: {
  instruction: Instruction;
  paymentRecorded: boolean;
}) {
  const styles = useApplicationStyles();
  const bank = instruction.rail === 'bank_transfer';
  return (
    <Section title="Payment instruction">
      <Text style={styles.help}>
        {paymentRecorded
          ? 'A payment has already been recorded. Confirm any remaining payment with the operator before paying again. These are the original instruction amounts.'
          : SUBSCRIPTION_COPY.AWAITING_PAYMENT_HELP}
      </Text>
      <Rows>
        <InstructionRow
          key={`reference-${instruction.reference}`}
          label="Reference"
          value={instruction.reference}
          copyable
        />
        <InstructionRow
          key={`amount-${instruction.amountDue}`}
          label="Amount on instruction"
          value={instruction.amountDue}
          display={formatMoney(instruction.amountDue, instruction.currency)}
          copyable
        />
        <InstructionRow label="Pay to" value={instruction.payee} />
        {bank ? (
          <>
            <InstructionRow
              key={`name-${instruction.bankAccountName}`}
              label="Account name"
              value={instruction.bankAccountName}
              copyable
            />
            <InstructionRow key={`bsb-${instruction.bankBsb}`} label="BSB" value={instruction.bankBsb} copyable />
            <InstructionRow
              key={`bank-${instruction.bankAccountNumber}`}
              label="Account number"
              value={instruction.bankAccountNumber}
              copyable
            />
          </>
        ) : (
          <>
            <InstructionRow label="Asset" value={instruction.assetSymbol} />
            <InstructionRow label="Network" value={instruction.chain} />
            <InstructionRow
              key={`contract-${instruction.contractAddress}`}
              label="Token contract"
              value={instruction.contractAddress}
              copyable
            />
            <InstructionRow
              key={`wallet-${instruction.receivingWalletAddress}`}
              label="Receiving wallet"
              value={instruction.receivingWalletAddress}
              copyable
            />
            <InstructionRow
              key={`raw-${instruction.settlementAmount}`}
              label="Raw units"
              value={instruction.settlementAmount}
              copyable
            />
            <InstructionRow
              label="Decimals"
              value={instruction.decimals === undefined ? undefined : String(instruction.decimals)}
            />
          </>
        )}
        {instruction.issuedAt && <InstructionRow label="Issued" value={formatDate(instruction.issuedAt)} />}
        {instruction.paymentDueAt && <InstructionRow label="Due by" value={formatDate(instruction.paymentDueAt)} />}
      </Rows>
      {!bank && (
        <Text style={styles.help}>
          Use the stated asset and network. The operator confirms the transfer by its hash, and one transfer can fund
          one application only.
        </Text>
      )}
    </Section>
  );
}
