import { useRef, useState } from 'react';
import {
  isRegisterEvidenceReceipt,
  isUuid,
  uploadRegisterEvidence,
  useCompanyMemberAccess,
  type RegisterEvidence,
} from '@ledova/shared';
import { Section } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { FIELD_CLASS } from '@components/fieldClass';
import apiClient from '@services/apiClient';

export function CompanyMemberAccess({ company, sourceReady = true }: { company: string; sourceReady?: boolean }) {
  const access = useCompanyMemberAccess(apiClient, company, () => crypto.randomUUID(), undefined, sourceReady);
  const [member, setMember] = useState('');
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [request, setRequest] = useState('');
  const [certificateInstruction, setCertificateInstruction] = useState('');
  const [asAt, setAsAt] = useState(new Date().toISOString().slice(0, 10));
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const uploaded = useRef<{ file: File; appointment: string; key: string; receipt: RegisterEvidence | null } | null>(
    null,
  );
  const held = access.busy || uploading || !!access.retry;
  const prepare = async () => {
    if (!file || !access.prepare || uploading) return;
    setUploading(true);
    setUploadError('');
    try {
      access.guardPrepare();
      const appointment = access.prepare.uuid;
      if (uploaded.current?.file !== file || uploaded.current.appointment !== appointment)
        uploaded.current = { file, appointment, key: crypto.randomUUID(), receipt: null };
      const current = uploaded.current;
      const evidenceRequest = {
        companyId: company,
        appointment,
        kind: 'supporting' as const,
        idempotencyKey: current.key,
      };
      if (!current.receipt) {
        const { data } = await uploadRegisterEvidence(
          apiClient,
          { ...evidenceRequest, file },
          { ledovaSubmissionGuard: access.guardPrepare },
        );
        access.guardPrepare();
        if (!isRegisterEvidenceReceipt(data, evidenceRequest, file.size))
          throw new Error('The company evidence upload could not be confirmed.');
        current.receipt = data;
      }
      await access.prepareRequest(request, current.receipt.uuid, asAt, reason.trim());
    } catch (failure) {
      setUploadError(failure instanceof Error ? failure.message : 'The supporting document could not be uploaded.');
    } finally {
      setUploading(false);
    }
  };
  return (
    <Section title="Member access and requests">
      <p className="text-sm text-text-muted">
        A current company administrator invites one exact member to their own records. This creates no company
        appointment, holding or wallet link. Share the code privately; Ledova does not email it.
      </p>
      <PageAction
        label="Refresh member access"
        disabled={access.busy || uploading}
        onClick={() => void access.refresh()}
      />
      {access.error && (
        <p role="alert" className="text-sm text-error-light">
          {access.error}
        </p>
      )}
      {access.notice && (
        <p role="status" className="text-sm">
          {access.notice}
        </p>
      )}
      {access.retry && (
        <PageAction
          label="Retry original company member action"
          disabled={access.busy}
          onClick={() => void access.recover()}
        />
      )}
      {access.admin && (
        <>
          <label className="block space-y-1 text-sm">
            Member UUID
            <input
              className={FIELD_CLASS}
              value={member}
              disabled={held}
              onChange={(event) => setMember(event.target.value)}
            />
          </label>
          <p className="text-sm text-text-muted">
            Use the member UUID recorded in this company&apos;s Register or employee award; an award-only recipient
            needs no holding.
          </p>
          <label className="block space-y-1 text-sm">
            Intended recipient email
            <input
              className={FIELD_CLASS}
              type="email"
              value={email}
              disabled={held}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <PageAction
            label="Create member invitation"
            disabled={held || !isUuid(member) || !email.trim()}
            onClick={() => void access.invite(member, email.trim())}
          />
          {access.code && (
            <label className="block space-y-1 text-sm">
              One-time member invitation code
              <input className={FIELD_CLASS} readOnly autoComplete="off" value={access.code} />
            </label>
          )}
          {access.access?.invitations.map((invitation) => (
            <p key={invitation.uuid} className="text-sm">
              Invitation {invitation.uuid} · Member {invitation.member} · {invitation.intendedEmail} ·{' '}
              {invitation.status} · Until {invitation.acceptanceDeadline}
            </p>
          ))}
          <label className="block space-y-1 text-sm">
            Company action reason
            <textarea
              className={FIELD_CLASS}
              value={reason}
              disabled={held}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          {access.access?.associations.map((association) => (
            <div key={association.uuid} className="space-y-2 py-2">
              <p className="text-sm">
                Member {association.member} · Account {association.userAccount} ·{' '}
                {association.current ? 'Current access' : 'Revoked access'}
              </p>
              {association.current && (
                <PageAction
                  label={`Revoke member access ${association.uuid}`}
                  disabled={held || !reason.trim()}
                  onClick={() => void access.revoke(association.uuid, reason.trim())}
                />
              )}
            </div>
          ))}
        </>
      )}
      {access.requests && (
        <>
          <p className="text-sm text-text-muted">
            Member particulars requests are proposals. Prepare a separate company instruction with your supporting
            evidence; approval and application use Register particulars changes below.
          </p>
          {access.requests.particulars.map((item) => (
            <div key={item.uuid} className="space-y-2 py-2">
              <p className="text-sm">
                Member {item.member} · {item.name} · {item.residentialAddress} · {item.status}
                {item.change ? ` · Company instruction ${item.change}` : ''}
              </p>
              {item.status === 'submitted' && access.prepare && (
                <PageAction
                  label={`Prepare member particulars request ${item.uuid}`}
                  disabled={held}
                  onClick={() => setRequest(item.uuid)}
                />
              )}
            </div>
          ))}
          {access.requests.particulars.some((item) => item.uuid === request && item.status === 'submitted') &&
            access.prepare && (
              <div className="space-y-3">
                <p className="text-sm">Selected member request {request}</p>
                <label className="block space-y-1 text-sm">
                  Company supporting document
                  <input
                    className={FIELD_CLASS}
                    type="file"
                    accept="application/pdf,image/png,image/jpeg"
                    disabled={held}
                    onChange={(event) => {
                      setFile(event.target.files?.[0] ?? null);
                      uploaded.current = null;
                    }}
                  />
                </label>
                <label className="block space-y-1 text-sm">
                  As-at date (UTC)
                  <input
                    className={FIELD_CLASS}
                    type="date"
                    value={asAt}
                    disabled={held}
                    onChange={(event) => setAsAt(event.target.value)}
                  />
                </label>
                {!access.admin && (
                  <label className="block space-y-1 text-sm">
                    Company action reason
                    <textarea
                      className={FIELD_CLASS}
                      value={reason}
                      disabled={held}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </label>
                )}
                {uploadError && (
                  <p role="alert" className="text-sm text-error-light">
                    {uploadError}
                  </p>
                )}
                <PageAction
                  label="Record company particulars instruction"
                  disabled={held || !file || !reason.trim() || !asAt}
                  onClick={() => void prepare()}
                />
              </div>
            )}
          <p className="text-sm text-text-muted">
            Fulfil a genuine receiving issue or transfer with an unsigned recipient-only PDF. The company remains
            responsible for execution and permitted use.
          </p>
          <label className="block space-y-1 text-sm">
            Certificate instruction reference
            <input
              className={FIELD_CLASS}
              value={certificateInstruction}
              maxLength={255}
              disabled={held || !!access.certificateTarget}
              onChange={(event) => setCertificateInstruction(event.target.value)}
            />
          </label>
          {access.certificateTarget && (
            <div className="space-y-2">
              <p>
                Recipient member {access.certificateTarget.preview.member} · Entry{' '}
                {access.certificateTarget.preview.sequence} · Register sequence{' '}
                {access.certificateTarget.preview.registerSequence}
              </p>
              <PageAction
                label="Confirm recipient certificate fulfilment"
                disabled={held}
                onClick={() => void access.fulfilCertificate()}
              />
              <PageAction label="Edit recipient certificate request" disabled={held} onClick={access.editCertificate} />
            </div>
          )}
          {access.requests.certificates.map((item) => (
            <div key={item.uuid} className="space-y-2">
              <p className="text-sm">
                Certificate request {item.uuid} · Member {item.member} · Entry {item.entry} · {item.status}
              </p>
              {item.fulfilment && (
                <p className="text-sm">
                  Unsigned PDF {item.fulfilment.uuid} · SHA-256 {item.fulfilment.digest} · {item.fulfilment.fileSize}{' '}
                  bytes
                </p>
              )}
              {item.status === 'requested' && (
                <PageAction
                  label={`Preview recipient certificate ${item.uuid}`}
                  disabled={held || !!access.certificateTarget || !certificateInstruction.trim()}
                  onClick={() => void access.previewCertificate(item.uuid, certificateInstruction.trim())}
                />
              )}
            </div>
          ))}
        </>
      )}
    </Section>
  );
}
