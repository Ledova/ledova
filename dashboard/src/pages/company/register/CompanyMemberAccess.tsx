import { Field, TextArea, TextInput, FileField } from '@components/Field';
import { useEffect, useRef, useState } from 'react';
import { useRunningAction } from '@hooks/useRunningAction';
import {
  FIELD_LIMITS,
  formatDateTime,
  type OrderSubmissionOwner,
  type TokenHoldersResponse,
  utcToday,
} from '@ledova/shared';
import { Outcome, Section, Loading, LoadError } from '@components/Ledger';
import { PersonSelect } from '@pages/company/register/shared/PersonPicker';
import { PageAction } from '@components/Page';
import { Confirmation } from '@components/Modal';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { INVITATION_FIELDS, PARTICULARS_FIELDS, useCompanyMemberRequests } from './useCompanyMemberRequests';

export function CompanyMemberAccess({
  company,
  owner,
  guard,
  registers,
  sourceReady = true,
  inviteMember,
  onHeldChange,
}: {
  company: string;
  owner: OrderSubmissionOwner;
  guard: () => void;
  registers: TokenHoldersResponse[];
  sourceReady?: boolean;
  inviteMember?: string;
  onHeldChange?: (held: boolean) => void;
}) {
  const {
    access,
    awards,
    candidates,
    recipientsError,
    recipientsReady,
    member,
    email,
    memberName,
    setInvitation,
    reason,
    setReason,
    request,
    setRequest,
    certificateInstruction,
    setCertificateInstruction,
    asAt,
    setAsAt,
    selectFile,
    uploading,
    uploadError,
    held,
    problems,
    refresh,
    prepare,
  } = useCompanyMemberRequests({ company, owner, guard, registers, sourceReady, inviteMember, onHeldChange });
  const candidateOf = new Map(candidates.map((candidate) => [candidate.uuid, candidate]));
  const { running, track } = useRunningAction();
  const checks = useErrorSummary(problems);
  const [revoking, setRevoking] = useState<{ uuid: string; name: string } | null>(null);
  const invite = useRef<HTMLHeadingElement>(null);
  const shown = !!inviteMember && member?.uuid === inviteMember;
  useEffect(() => {
    if (shown) invite.current?.scrollIntoView?.({ block: 'start' });
  }, [shown]);
  return (
    <Section title="Member access and requests">
      <p className="text-sm text-text-muted">
        A current company administrator invites one exact member to their own records. This creates no company
        appointment, holding or wallet link. Share the code privately; Ledova does not email it.
      </p>
      <ErrorSummary {...checks.summary} />
      <PageAction
        label="Refresh member access"
        busy={running === 'refresh'}
        busyLabel="Refreshing…"
        disabled={access.busy || uploading}
        onClick={() => track('refresh', refresh())}
      />
      {access.readFailed && (
        <LoadError retry={() => track('refresh', refresh())} busy={running === 'refresh' || access.busy || uploading}>
          Member access or members&apos; requests could not be loaded.
        </LoadError>
      )}
      {(access.readFailed ? access.failure : access.error) && (
        <p role="alert" className="text-sm text-error-light">
          {access.readFailed ? access.failure : access.error}
        </p>
      )}
      {access.notice && <Outcome>{access.notice}</Outcome>}
      {access.retry && (
        <PageAction
          label="Retry original company member action"
          disabled={access.busy}
          onClick={() => void access.recover()}
        />
      )}
      {access.admin && (
        <div className="space-y-4 border-t border-border-subtle pt-4">
          <h3 ref={invite} className="scroll-mt-6 text-base font-medium">
            Invite a member
          </h3>
          <PersonSelect
            {...checks.field('member')}
            label="Member or award recipient"
            people={candidates.map((candidate) => ({
              member: candidate.uuid,
              name: candidate.name,
              residentialAddress: '',
              walletless: true,
              particularsRetained: true,
              currentShares: '0',
              lastCeasedOn: null,
              awardOnly: candidate.sources.length === 1 && candidate.sources[0] === 'Award recipient',
            }))}
            value={member?.uuid ?? ''}
            onChange={(value) => setInvitation({ company, member: value, email })}
            allowNew={false}
            disabled={held || !recipientsReady}
            context={(person) => {
              const candidate = candidateOf.get(person.member);
              return candidate
                ? [candidate.classes.join(', '), ...(person.awardOnly ? [] : [candidate.sources.join(', ')])].join(
                    ' · ',
                  )
                : '';
            }}
          />
          {awards.isPending && <Loading>Loading company recipients…</Loading>}
          {awards.isError ? (
            <LoadError retry={() => awards.refetch()} busy={awards.isFetching}>
              The company recipients could not be loaded.
            </LoadError>
          ) : (
            recipientsError && (
              <p role="alert" className="text-sm text-error-light">
                {recipientsError}
              </p>
            )
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
          <Field {...checks.field('email')} label="Intended recipient email">
            <TextInput
              maxLength={FIELD_LIMITS.EMAIL}
              type="email"
              value={email}
              disabled={held}
              onChange={(event) => setInvitation({ company, member: member?.uuid ?? '', email: event.target.value })}
            />
          </Field>
          <PageAction
            label="Create member invitation"
            primary
            busy={running === 'invite'}
            busyLabel="Creating invitation…"
            disabled={held || !recipientsReady}
            onClick={() => {
              if (checks.check(INVITATION_FIELDS) && member) track('invite', access.invite(member.uuid, email.trim()));
            }}
          />
          {access.code && (
            <Field label="One-time member invitation code">
              <TextInput readOnly autoComplete="off" value={access.code} />
            </Field>
          )}
          {access.access?.invitations.map((item) => (
            <div key={item.uuid} className="space-y-1 text-sm">
              <p>
                {memberName(item.member)} · {item.intendedEmail} · {item.status} · Until{' '}
                {formatDateTime(item.acceptanceDeadline)}
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
          <Field {...checks.field('reason')} label="Company action reason">
            <TextArea
              maxLength={FIELD_LIMITS.REASON}
              value={reason}
              disabled={held}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
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
                  disabled={held}
                  onClick={() => {
                    if (checks.check(['reason']))
                      setRevoking({ uuid: association.uuid, name: memberName(association.member) });
                  }}
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
            evidence, then approve and apply it under Register, History.
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
                <FileField
                  {...checks.field('file')}
                  label="Company supporting document"
                  disabled={held}
                  onFile={selectFile}
                />
                <Field {...checks.field('asAt')} label="As-at date (UTC)">
                  <TextInput
                    type="date"
                    max={utcToday()}
                    value={asAt}
                    disabled={held}
                    onChange={(event) => setAsAt(event.target.value)}
                  />
                </Field>
                {!access.admin && (
                  <Field {...checks.field('reason')} label="Company action reason">
                    <TextArea
                      maxLength={FIELD_LIMITS.REASON}
                      value={reason}
                      disabled={held}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </Field>
                )}
                {uploadError && (
                  <p role="alert" className="text-sm text-error-light">
                    {uploadError}
                  </p>
                )}
                <PageAction
                  label="Record company particulars instruction"
                  primary
                  busy={running === 'particulars'}
                  busyLabel="Recording instruction…"
                  disabled={held}
                  onClick={() => {
                    if (checks.check(PARTICULARS_FIELDS)) track('particulars', prepare());
                  }}
                />
              </div>
            )}
          <h3 className="border-t border-border-subtle pt-4 text-base font-medium">Certificate requests</h3>
          <p className="text-sm text-text-muted">
            Fulfil a genuine receiving issue or transfer with an unsigned recipient-only PDF. The company remains
            responsible for execution and permitted use.
          </p>
          <Field {...checks.field('instruction')} label="Certificate instruction reference">
            <TextInput
              value={certificateInstruction}
              maxLength={FIELD_LIMITS.REFERENCE}
              disabled={held || !!access.certificateTarget}
              onChange={(event) => setCertificateInstruction(event.target.value)}
            />
          </Field>
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
                busy={running === 'fulfil'}
                busyLabel="Confirming fulfilment…"
                disabled={held}
                onClick={() => track('fulfil', access.fulfilCertificate())}
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
                  busy={running === `preview:${item.uuid}`}
                  busyLabel="Previewing…"
                  disabled={held || !!access.certificateTarget}
                  onClick={() => {
                    if (checks.check(['instruction']))
                      track(
                        `preview:${item.uuid}`,
                        access.previewCertificate(item.uuid, certificateInstruction.trim()),
                      );
                  }}
                />
              )}
            </div>
          ))}
        </div>
      )}
      {revoking && (
        <Confirmation
          isOpen
          title={`Revoke access for ${revoking.name}?`}
          confirmLabel="Revoke access"
          confirmDisabled={held || !reason.trim() || !access.admin}
          busy={access.busy}
          busyLabel="Revoking…"
          onClose={() => setRevoking(null)}
          onConfirm={() =>
            void Promise.resolve(access.revoke(revoking.uuid, reason.trim())).finally(() => setRevoking(null))
          }
        >
          They lose access to their own records and files and can&apos;t make new requests, though they can still read
          the status of requests they made. Relinking needs a new invitation.
        </Confirmation>
      )}
    </Section>
  );
}
