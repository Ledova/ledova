import { SelectField } from '@components/SelectField';
import { CheckboxField } from '@components/Field';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { useEffect, useState } from 'react';
import { useEntryReads } from '@hooks/useEntryReads';
import { useRunningAction } from '@hooks/useRunningAction';
import {
  useWalletNomination,
  formatDateTime,
  COMPANY_WALLET_UNMET_COPY,
  type WalletNominationPreview,
  refusalSentences,
  shortReference,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import { FormActions, PageAction } from '@components/Page';
import { Row, Rows, Section, LoadError } from '@components/Ledger';
import { WalletVerificationModal } from '@components/wallet/WalletVerificationModal';
import { useCompanyNames } from '@hooks/useCompanyNames';

function Facts({ preview, company }: { preview: WalletNominationPreview; company: string }) {
  return (
    <Rows>
      <Row label="Company">{company}</Row>
      <Row label="Eligibility">{preview.decision ? 'Accepted' : 'Not ready'}</Row>
      <Row label="Selected address">
        <span className="break-all">{preview.address}</span>
      </Row>
      <Row label="Possession proof completed">{formatDateTime(preview.proofCompletedAt)}</Row>
      <Row label="Eligibility expiry">{formatDateTime(preview.eligibilityExpiresAt)}</Row>
    </Rows>
  );
}

export function WalletNomination({
  requestUuid,
  guardRequest,
  onHeldChange,
  active = true,
}: {
  requestUuid: string;
  guardRequest: () => void;
  onHeldChange: (held: boolean) => void;
  active?: boolean;
}) {
  const [verifying, setVerifying] = useState<{
    owner: OrderSubmissionOwner | null;
    wallet: string;
    scope: string;
  } | null>(null);
  const data = useWalletNomination({
    requestUuid,
    newKey: () => crypto.randomUUID(),
    guardRequest,
    coordinatedReads: true,
    paused: !active,
    pausedScope: verifying?.scope,
  });
  const { running, track } = useRunningAction();
  const named = useCompanyNames();
  const companyName = (uuid: string) => named(uuid) ?? `Company ${shortReference(uuid)}`;
  const reads = [data.request, data.nominations, data.wallets];
  const readFailed = reads.some((read) => read.isError);
  const [consent, setConsent] = useState<{ preview: WalletNominationPreview | null; accepted: boolean }>({
    preview: null,
    accepted: false,
  });
  const wallets = data.wallets.isSuccess ? data.wallets.data : [];
  const wallet = wallets.find((row) => row.uuid === data.walletUuid);
  const blocked = data.busy || data.request.isFetching || data.wallets.isFetching;
  const preview = data.preview;
  const accepted = consent.preview === preview && consent.accepted;
  const proofOpen = verifying?.owner === data.owner && verifying.wallet === wallet?.uuid;
  useEffect(() => {
    onHeldChange(active && (data.readingPaused || !!proofOpen));
    return () => onHeldChange(false);
  }, [active, data.readingPaused, proofOpen, onHeldChange]);
  useEntryReads({
    scope: active && data.owner ? data.scopeKey : null,
    paused: data.readingPaused || !!proofOpen,
    refresh: data.refresh,
  });
  const checks = useErrorSummary({
    wallet: !wallet && 'Choose one of your own Base wallets.',
    consent: !accepted && 'Agree to share the selected address with this company.',
  });
  if (!data.owner) return null;
  return (
    <Section title="Nominate your Base wallet">
      <p className="text-sm text-text-muted">
        Choose one of your Base wallets for this company, and check its eligibility and the proof that you control it.
        Sharing evidence never shares your wallets.
      </p>
      <ErrorSummary {...checks.summary} />
      {data.original && (
        <div className="space-y-3">
          <p role="status">
            This nomination&apos;s outcome is unconfirmed. Recover its receipt with the identical original request.
          </p>
          <Facts preview={data.original.preview} company={companyName(data.original.preview.company)} />
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
            label="Your Base wallet"
            options={[
              { value: '', label: 'Choose a wallet' },
              ...wallets.map((row) => ({
                value: row.uuid,
                label: `${row.name || 'Base wallet'} · ${row.address}`,
              })),
            ]}
            value={data.walletUuid}
            disabled={blocked}
            onChange={(uuid) => {
              checks.reset();
              data.setWallet(uuid);
            }}
          />
          {data.wallets.isSuccess && wallets.length === 0 && (
            <p className="text-sm text-text-muted">No own Base wallets yet.</p>
          )}
          {preview && (
            <div className="space-y-3">
              <Facts preview={preview} company={companyName(preview.company)} />
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
            </div>
          )}
          <FormActions>
            {wallet && (
              <PageAction
                label="Refresh selected wallet possession proof"
                disabled={blocked}
                onClick={() => {
                  try {
                    data.guardWallet();
                    setVerifying({ owner: data.owner, wallet: wallet.uuid, scope: data.scopeKey });
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
              <PageAction
                label="Submit wallet nomination"
                primary
                disabled={blocked || !preview.canSubmit}
                onClick={() => {
                  if (checks.check(['consent'])) void data.confirm();
                }}
              />
            )}
          </FormActions>
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
          Only the selected address and the facts needed to approve it are shared with the company.
        </p>
        {data.receipt && !data.nominations.isSuccess && (
          <Rows>
            <Row label="Shared address">
              <span className="break-all">{data.receipt.address}</span>
            </Row>
            <Row label="Company">{companyName(data.receipt.company)}</Row>
          </Rows>
        )}
        {(data.nominations.isSuccess ? data.nominations.data : []).map((record) => (
          <Rows key={record.uuid}>
            <Row label="Company">{companyName(record.company)}</Row>
            <Row label="Shared address">
              <span className="break-all">{record.address}</span>
            </Row>
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
