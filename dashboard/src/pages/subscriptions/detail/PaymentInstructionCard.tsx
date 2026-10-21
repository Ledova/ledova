import { SUBSCRIPTION_COPY, formatDate, formatMoney } from '@ledova/shared';
import type { PaymentInstruction } from '@ledova/shared';
import { Row, Rows, Section } from '@components/Ledger';
import { CopyButton } from '@components/CopyButton';

function InstructionRow({
  label,
  value,
  copyable = false,
  display,
}: {
  label: string;
  value?: string;
  copyable?: boolean;
  display?: string;
}) {
  return (
    <Row label={label}>
      <div className="flex min-w-0 flex-col items-end gap-2">
        <span className="break-all">{display ?? value ?? 'Unavailable'}</span>
        {copyable && value && <CopyButton key={value} value={value} label={`Copy ${label.toLowerCase()}`} />}
      </div>
    </Row>
  );
}

export function PaymentInstructionCard({
  instruction,
  paymentRecorded = false,
}: {
  instruction: PaymentInstruction;
  paymentRecorded?: boolean;
}) {
  const isBank = instruction.rail === 'bank_transfer';

  return (
    <Section title="Payment instruction">
      <p className="py-2 text-sm text-text-muted">
        {paymentRecorded
          ? 'A payment has already been recorded. Confirm any remaining payment with the operator before paying again. These are the original instruction amounts.'
          : SUBSCRIPTION_COPY.AWAITING_PAYMENT_HELP}
      </p>
      <Rows>
        <InstructionRow label="Reference" value={instruction.reference} copyable />
        <InstructionRow
          label="Amount on instruction"
          value={instruction.amountDue}
          display={formatMoney(instruction.amountDue, instruction.currency)}
          copyable
        />
        <InstructionRow label="Pay to" value={instruction.payee} />
        {isBank ? (
          <>
            <InstructionRow label="Account name" value={instruction.bankAccountName} copyable />
            <InstructionRow label="BSB" value={instruction.bankBsb} copyable />
            <InstructionRow label="Account number" value={instruction.bankAccountNumber} copyable />
          </>
        ) : (
          <>
            <InstructionRow label="Asset" value={instruction.assetSymbol} />
            <InstructionRow label="Network" value={instruction.chain} />
            <InstructionRow label="Token contract" value={instruction.contractAddress} copyable />
            <InstructionRow label="Receiving wallet" value={instruction.receivingWalletAddress} copyable />
            <InstructionRow label="Raw units" value={instruction.settlementAmount} copyable />
            <InstructionRow
              label="Decimals"
              value={instruction.decimals === undefined ? undefined : String(instruction.decimals)}
            />
          </>
        )}
        {instruction.issuedAt && <InstructionRow label="Issued" value={formatDate(instruction.issuedAt)} />}
        {instruction.paymentDueAt && <InstructionRow label="Due by" value={formatDate(instruction.paymentDueAt)} />}
      </Rows>
      {!isBank && (
        <p className="py-2 text-sm text-text-muted">
          Use the stated asset and network. The operator confirms the transfer by its hash, and one transfer can fund
          one application only.
        </p>
      )}
    </Section>
  );
}
