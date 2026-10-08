import { useState } from 'react';
import {
  useWalletNomination,
  formatDateTime,
  COMPANY_WALLET_UNMET_COPY,
  type WalletNominationPreview,
} from '@ledova/shared';
import { PageAction } from '@components/Page';
import { Row, Rows, Section } from '@components/Ledger';
import { FIELD_CLASS } from '@components/fieldClass';
import apiClient from '@services/apiClient';
import { WalletVerificationModal } from '../wallets/components/WalletVerificationModal';

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
  const data = useWalletNomination(apiClient, { requestUuid, newKey: () => crypto.randomUUID(), guardRequest });
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
  if (!data.owner) return null;
  return (
    <Section title="Nominate one own Base wallet">
      <p className="text-sm text-text-muted">
        Select one own wallet for this company and review its current GENERAL eligibility and possession proof. Earlier
        evidence sharing does not share your wallets.
      </p>
      <PageAction label="Refresh wallet nomination" disabled={data.busy} onClick={() => void data.refresh()} />
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
      {(data.request.isError || data.wallets.isError) && (
        <p role="alert">
          The current own request or wallets could not be checked. Your original request remains available for recovery.
        </p>
      )}
      {!data.original && (
        <>
          <label className="space-y-1 text-sm">
            Your own Base wallet
            <select
              aria-label="Nomination wallet"
              className={FIELD_CLASS}
              value={data.walletUuid}
              disabled={blocked}
              onChange={(event) => data.setWallet(event.target.value)}
            >
              <option value="">Select one own wallet</option>
              {wallets.map((row) => (
                <option key={row.uuid} value={row.uuid}>
                  {row.name || 'Own Base wallet'} · {row.address}
                </option>
              ))}
            </select>
          </label>
          {data.wallets.isSuccess && wallets.length === 0 && <p>No own Base wallets are available.</p>}
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
            disabled={blocked || !wallet}
            onClick={() => void data.review()}
          />
          {preview && (
            <div className="space-y-3">
              <Facts preview={preview} />
              {preview.unmetRequirements.map((code) => (
                <p key={code} className="text-sm text-text-muted">
                  {COMPANY_WALLET_UNMET_COPY[code] ?? code}
                </p>
              ))}
              <label className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={accepted}
                  disabled={blocked}
                  onChange={(event) => setConsent({ preview, accepted: event.target.checked })}
                />
                Share this selected address with this exact company.
              </label>
              <PageAction
                label="Submit wallet nomination"
                primary
                disabled={blocked || !accepted || !preview.canSubmit}
                onClick={() => void data.confirm()}
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
            {record.unmetRequirements.map((code) => (
              <Row key={code} label="Current readiness">
                {COMPANY_WALLET_UNMET_COPY[code] ?? code}
              </Row>
            ))}
          </Rows>
        ))}
      </div>
    </Section>
  );
}
