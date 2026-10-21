import { SelectField } from '@components/SelectField';
import { CheckboxField } from '@components/Field';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { useState } from 'react';
import { useRunningAction } from '@hooks/useRunningAction';
import {
  useWalletNomination,
  formatDateTime,
  COMPANY_WALLET_UNMET_COPY,
  type WalletNominationPreview,
  refusalSentences,
} from '@ledova/shared';
import { PageAction } from '@components/Page';
import { Row, Rows, Section, LoadError } from '@components/Ledger';
import { WalletVerificationModal } from '@components/wallet/WalletVerificationModal';

function Facts({ preview }: { preview: WalletNominationPreview }) {
  return (
    <Rows>
      <Row label="Exact company">{preview.company}</Row>
      <Row label="Eligibility request">{preview.request}</Row>
      <Row label="Accepted GENERAL decision">{preview.decision ?? 'Not ready'}</Row>
      <Row label="Selected address">{preview.address}</Row>
      <Row label="Chain">{preview.chain}</Row>
      <Row label="Possession proof completed">{formatDateTime(preview.proofCompletedAt)}</Row>
      <Row label="Eligibility expiry">{formatDateTime(preview.eligibilityExpiresAt)}</Row>
      <Row label="Preview fingerprint">{preview.previewDigest}</Row>
    </Rows>
  );
}

export function WalletNomination({ requestUuid, guardRequest }: { requestUuid: string; guardRequest: () => void }) {
  const data = useWalletNomination({ requestUuid, newKey: () => crypto.randomUUID(), guardRequest });
  const { running, track } = useRunningAction();
  const reads = [data.request, data.nominations, data.wallets];
  const readFailed = reads.some((read) => read.isError);
  const [consent, setConsent] = useState<{ preview: WalletNominationPreview | null; accepted: boolean }>({
    preview: null,
    accepted: false,
  });
  const [verifying, setVerifying] = useState<{ owner: typeof data.owner; wallet: string } | null>(null);
  const wallets = data.wallets.isSuccess ? data.wallets.data : [];
  const wallet = wallets.find((row) => row.uuid === data.walletUuid);
  const blocked = data.busy || data.request.isFetching || data.wallets.isFetching;
  const preview = data.preview;
  const accepted = consent.preview === preview && consent.accepted;
  const proofOpen = verifying?.owner === data.owner && verifying.wallet === wallet?.uuid;
  const checks = useErrorSummary({
    wallet: !wallet && 'Choose one of your own Base wallets.',
    consent: !accepted && 'Agree to share the selected address with this company.',
  });
  if (!data.owner) return null;
  return (
    <Section title="Nominate one own Base wallet">
      <p className="text-sm text-text-muted">
        Select one own wallet for this company and review its current GENERAL eligibility and possession proof. Earlier
        evidence sharing does not share your wallets.
      </p>
      <ErrorSummary {...checks.summary} />
      {!readFailed && (
        <PageAction
          label="Refresh wallet nomination"
          busy={running === 'refresh'}
          busyLabel="Refreshing…"
          disabled={data.busy}
          onClick={() => track('refresh', data.refresh())}
        />
      )}
      {data.original && (
        <div className="space-y-3">
          <p role="status">This original nomination is unconfirmed. Recover its receipt with the same body and key.</p>
          <Facts preview={data.original.preview} />
          <Rows>
            <Row label="Original nomination key">{data.original.body.operationId}</Row>
          </Rows>
          <PageAction label="Recover original nomination" disabled={data.busy} onClick={() => void data.recover()} />
        </div>
      )}
      {data.error && (
        <p role="alert" className="text-sm text-error-light">
          {data.error}
        </p>
      )}
      {readFailed && (
        <LoadError retry={() => track('refresh', data.refresh())} busy={running === 'refresh' || data.busy}>
          Your request, nominations or own wallets could not be{' '}
          {reads.every((read) => !read.isError || read.data) ? 'refreshed' : 'loaded'}. Your original request remains
          available for recovery.
        </LoadError>
      )}
      {!data.original && (
        <>
          <SelectField
            {...checks.field('wallet')}
            label="Your own Base wallet"
            options={[
              { value: '', label: 'Select one own wallet' },
              ...wallets.map((row) => ({
                value: row.uuid,
                label: `${row.name || 'Own Base wallet'} · ${row.address}`,
              })),
            ]}
            value={data.walletUuid}
            disabled={blocked}
            onChange={data.setWallet}
          />
          {data.wallets.isSuccess && wallets.length === 0 && (
            <p className="text-sm text-text-muted">No own Base wallets yet.</p>
          )}
          {wallet && (
            <PageAction
              label="Refresh selected wallet possession proof"
              disabled={blocked}
              onClick={() => {
                try {
                  data.guardWallet();
                  setVerifying({ owner: data.owner, wallet: wallet.uuid });
                } catch {
                  return;
                }
              }}
            />
          )}
          <PageAction
            label="Review wallet nomination"
            busy={running === 'review'}
            busyLabel="Reviewing…"
            disabled={blocked}
            onClick={() => {
              if (checks.check(['wallet'])) track('review', data.review());
            }}
          />
          {preview && (
            <div className="space-y-3">
              <Facts preview={preview} />
              {refusalSentences(preview.unmetRequirements, COMPANY_WALLET_UNMET_COPY).map((sentence) => (
                <p key={sentence} className="text-sm text-text-muted">
                  {sentence}
                </p>
              ))}
              <CheckboxField
                {...checks.field('consent')}
                label="Share this selected address with this exact company."
                checked={accepted}
                disabled={blocked}
                onChange={(event) => setConsent({ preview, accepted: event.target.checked })}
              />
              <PageAction
                label="Submit wallet nomination"
                primary
                disabled={blocked || !preview.canSubmit}
                onClick={() => {
                  if (checks.check(['consent'])) void data.confirm();
                }}
              />
            </div>
          )}
        </>
      )}
      <WalletVerificationModal
        isOpen={!!proofOpen}
        wallet={proofOpen ? wallet! : null}
        guard={data.guardWallet}
        onClose={() => {
          setVerifying(null);
          void data.refresh();
        }}
      />
      <div className="space-y-3">
        <p className="text-sm text-text-muted">
          Only the selected address and its minimal approval facts are shared with the actual company.
        </p>
        {data.receipt && !data.nominations.isSuccess && (
          <Rows>
            <Row label="Retained nomination receipt">{data.receipt.uuid}</Row>
            <Row label="Shared address">{data.receipt.address}</Row>
            <Row label="Company">{data.receipt.company}</Row>
          </Rows>
        )}
        {(data.nominations.isSuccess ? data.nominations.data : []).map((record) => (
          <Rows key={record.uuid}>
            <Row label="Retained nomination">{record.uuid}</Row>
            <Row label="Company">{record.company}</Row>
            <Row label="Shared address">{record.address}</Row>
            <Row label="Chain">{record.chain}</Row>
            <Row label="Submitted">{formatDateTime(record.submittedAt)}</Row>
            {refusalSentences(record.unmetRequirements, COMPANY_WALLET_UNMET_COPY).map((sentence) => (
              <Row key={sentence} label="Current readiness">
                {sentence}
              </Row>
            ))}
          </Rows>
        ))}
      </div>
    </Section>
  );
}
