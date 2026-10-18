import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getRegisterAwards,
  isRegisterEvidenceReceipt,
  readEveryPage,
  uploadRegisterEvidence,
  useCompanyMemberAccess,
  type RegisterEvidence,
  type OrderSubmissionOwner,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Section } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { FIELD_CLASS } from '@components/fieldClass';
import apiClient from '@services/apiClient';
import { invitationMembers } from './invitationMembers';
import { READ_TIMING, registerKey } from '@hooks/useRegisterAccess';
import { particularsKey } from './useRegisterParticulars';

export function CompanyMemberAccess({
  company,
  owner,
  guard,
  registers,
  sourceReady = true,
  onHeldChange,
}: {
  company: string;
  owner: OrderSubmissionOwner;
  guard: () => void;
  registers: TokenHoldersResponse[];
  sourceReady?: boolean;
  onHeldChange?: (held: boolean) => void;
}) {
  const access = useCompanyMemberAccess(
    apiClient,
    company,
    () => crypto.randomUUID(),
    undefined,
    sourceReady,
    particularsKey(owner, company),
  );
  const guardRecipients = () => {
    guard();
    access.guardPrepare();
  };
  const awards = useQuery({
    queryKey: [...registerKey(owner), 'invitation-awards', company],
    enabled: !!access.admin && !!access.prepare && sourceReady,
    queryFn: () =>
      readEveryPage(async (page) => {
        guardRecipients();
        const response = await getRegisterAwards(
          apiClient,
          { company, page },
          { ledovaSubmissionGuard: guardRecipients },
        );
        guardRecipients();
        return response;
      }),
    ...READ_TIMING,
  });
  let candidates = [] as ReturnType<typeof invitationMembers>;
  let recipientsError = '';
  if (access.admin && sourceReady && awards.isSuccess && !awards.isFetching) {
    try {
      candidates = invitationMembers(registers, awards.data, company);
    } catch (failure) {
      recipientsError = failure instanceof Error ? failure.message : 'The company recipients could not be confirmed.';
    }
  }
  const recipientsReady = !!access.admin && sourceReady && awards.isSuccess && !awards.isFetching && !recipientsError;
  const [invitation, setInvitation] = useState({ company, member: '', email: '' });
  const member = invitation.company === company ? candidates.find(({ uuid }) => uuid === invitation.member) : undefined;
  const email = invitation.company === company ? invitation.email : '';
  const memberName = (uuid: string) =>
    candidates.find((candidate) => candidate.uuid === uuid)?.name ||
    registers.flatMap((register) => register.holders).find((holder) => holder.member === uuid)?.name ||
    'Company member';
  if (invitation.company !== company || (recipientsReady && invitation.member && !member))
    setInvitation({ company, member: '', email: '' });
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
  useEffect(() => {
    onHeldChange?.(held);
    return () => onHeldChange?.(false);
  }, [held, onHeldChange]);
  const refresh = async () => {
    await access.refresh();
    await awards.refetch();
  };
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
      <PageAction label="Refresh member access" disabled={access.busy || uploading} onClick={() => void refresh()} />
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
        <div className="space-y-4 border-t border-border-subtle pt-4">
          <h3 className="text-base font-medium">Invite a member</h3>
          <label className="block space-y-1 text-sm">
            Member or award recipient
            <select
              className={FIELD_CLASS}
              value={member?.uuid ?? ''}
              disabled={held || !recipientsReady}
              onChange={(event) => setInvitation({ company, member: event.target.value, email })}
            >
              <option value="">Select a member</option>
              {candidates.map((candidate) => (
                <option key={candidate.uuid} value={candidate.uuid}>
                  {candidate.name} · {candidate.classes.join(', ')} · {candidate.sources.join(', ')}
                  {candidates.some((other) => other.uuid !== candidate.uuid && other.name === candidate.name)
                    ? ` · ${candidate.uuid.slice(0, 8)}`
                    : ''}
                </option>
              ))}
            </select>
          </label>
          {awards.isPending && (
            <p role="status" className="text-sm text-text-muted">
              Loading company recipients…
            </p>
          )}
          {(awards.isError || recipientsError) && (
            <p role="alert" className="text-sm text-error-light">
              {recipientsError || 'The company recipients could not be loaded. Refresh before inviting a member.'}
            </p>
          )}
          {recipientsReady && candidates.length === 0 && (
            <p className="text-sm text-text-muted">Record a member or employee award before inviting its recipient.</p>
          )}
          {member && (
            <details className="text-sm text-text-muted">
              <summary>Selected member record</summary>
              <p className="break-all">{member.uuid}</p>
            </details>
          )}
          <p className="text-sm text-text-muted">
            An award recipient can view their own award before any shares are issued.
          </p>
          <label className="block space-y-1 text-sm">
            Intended recipient email
            <input
              className={FIELD_CLASS}
              type="email"
              value={email}
              disabled={held}
              onChange={(event) => setInvitation({ company, member: member?.uuid ?? '', email: event.target.value })}
            />
          </label>
          <PageAction
            label="Create member invitation"
            primary
            disabled={held || !recipientsReady || !member || !email.trim()}
            onClick={() => member && void access.invite(member.uuid, email.trim())}
          />
          {access.code && (
            <label className="block space-y-1 text-sm">
              One-time member invitation code
              <input className={FIELD_CLASS} readOnly autoComplete="off" value={access.code} />
            </label>
          )}
          {access.access?.invitations.map((item) => (
            <div key={item.uuid} className="space-y-1 text-sm">
              <p>
                {memberName(item.member)} · {item.intendedEmail} · {item.status} · Until {item.acceptanceDeadline}
              </p>
              <details className="text-text-muted">
                <summary>Invitation record</summary>
                <p className="break-all">
                  Invitation {item.uuid} · Member {item.member}
                </p>
              </details>
            </div>
          ))}
          <h3 className="border-t border-border-subtle pt-4 text-base font-medium">Current member access</h3>
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
                {memberName(association.member)} · {association.current ? 'Current access' : 'Revoked access'}
              </p>
              <details className="text-sm text-text-muted">
                <summary>Access record</summary>
                <p className="break-all">
                  Member {association.member} · Account {association.userAccount} · Access {association.uuid}
                </p>
              </details>
              {association.current && (
                <PageAction
                  label={`Revoke access for ${memberName(association.member)}`}
                  disabled={held || !reason.trim()}
                  onClick={() => void access.revoke(association.uuid, reason.trim())}
                />
              )}
            </div>
          ))}
        </div>
      )}
      {access.requests && (
        <div className="space-y-4 border-t border-border-subtle pt-4">
          <h3 className="text-base font-medium">Particulars requests</h3>
          <p className="text-sm text-text-muted">
            Member particulars requests are proposals. Prepare a separate company instruction with your supporting
            evidence; approval and application use Register particulars changes below.
          </p>
          {access.requests.particulars.map((item) => (
            <div key={item.uuid} className="space-y-2 py-2">
              <p className="text-sm">
                {item.name} · {item.residentialAddress} · {item.status}
              </p>
              <details className="text-sm text-text-muted">
                <summary>Particulars request record</summary>
                <p className="break-all">
                  Request {item.uuid} · Member {item.member}
                  {item.change ? ` · Company instruction ${item.change}` : ''}
                </p>
              </details>
              {item.status === 'submitted' && access.prepare && (
                <PageAction
                  label={`Prepare particulars update for ${item.name}`}
                  disabled={held}
                  onClick={() => setRequest(item.uuid)}
                />
              )}
            </div>
          ))}
          {access.requests.particulars.some((item) => item.uuid === request && item.status === 'submitted') &&
            access.prepare && (
              <div className="space-y-3">
                <p className="text-sm">
                  Prepare {access.requests.particulars.find((item) => item.uuid === request)?.name}&apos;s particulars
                  update
                </p>
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
                  primary
                  disabled={held || !file || !reason.trim() || !asAt}
                  onClick={() => void prepare()}
                />
              </div>
            )}
          <h3 className="border-t border-border-subtle pt-4 text-base font-medium">Certificate requests</h3>
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
                {memberName(access.certificateTarget.preview.member)} · Entry{' '}
                {access.certificateTarget.preview.sequence} · Register sequence{' '}
                {access.certificateTarget.preview.registerSequence}
              </p>
              <PageAction
                label="Confirm recipient certificate fulfilment"
                primary
                disabled={held}
                onClick={() => void access.fulfilCertificate()}
              />
              <PageAction label="Edit recipient certificate request" disabled={held} onClick={access.editCertificate} />
            </div>
          )}
          {access.requests.certificates.map((item) => (
            <div key={item.uuid} className="space-y-2">
              <p className="text-sm">
                {memberName(item.member)} · Certificate {item.status}
              </p>
              <details className="text-sm text-text-muted">
                <summary>Certificate request record</summary>
                <p className="break-all">
                  Request {item.uuid} · Member {item.member} · Entry {item.entry}
                </p>
                {item.fulfilment && (
                  <p className="break-all">
                    Unsigned PDF {item.fulfilment.uuid} · SHA-256 {item.fulfilment.digest} · {item.fulfilment.fileSize}{' '}
                    bytes
                  </p>
                )}
              </details>
              {item.status === 'requested' && (
                <PageAction
                  label={`Preview certificate for ${memberName(item.member)}`}
                  disabled={held || !!access.certificateTarget || !certificateInstruction.trim()}
                  onClick={() => void access.previewCertificate(item.uuid, certificateInstruction.trim())}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
