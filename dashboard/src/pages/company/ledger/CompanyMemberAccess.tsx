import { Field, TextArea, TextInput, FileField } from '@components/Field';
import { useEffect, useRef, useState } from 'react';
import { useRunningAction } from '@hooks/useRunningAction';
import {
  FIELD_LIMITS,
  formatDate,
  formatDateTime,
  type OrderSubmissionOwner,
  type TokenHoldersResponse,
  utcToday,
  MEMBER_INVITATION_STATUS_LABELS,
  MEMBER_PARTICULARS_STATUS_LABELS,
  MEMBER_CERTIFICATE_STATUS_LABELS,
  shortReference,
} from '@ledova/shared';
import { Outcome, Section, Loading, LoadError, Disclosure, Rows, Row } from '@components/Ledger';
import { PersonSelect } from '@pages/company/ledger/shared/PersonPicker';
import { FormActions, PageAction } from '@components/Page';
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
  onEditingChange,
}: {
  company: string;
  owner: OrderSubmissionOwner;
  guard: () => void;
  registers: TokenHoldersResponse[];
  sourceReady?: boolean;
  inviteMember?: string;
  onHeldChange?: (held: boolean) => void;
  onEditingChange?: (editing: boolean) => void;
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
  const [invitationView, setInvitationView] = useState({
    open: false,
    target: '',
    receipt: access.invitationReceipt,
  });
  const inviting = invitationView.open && invitationView.receipt === access.invitationReceipt;
  const setInviting = (open: boolean) =>
    setInvitationView((current) => ({ ...current, open, receipt: access.invitationReceipt }));
  const [revokeMember, setRevokeMember] = useState('');
  const [revoking, setRevoking] = useState<{ uuid: string; name: string } | null>(null);
  const certificateContext = `${company}:${owner.userUuid}:${owner.ownerAccountUuid}`;
  const [certificateSelection, setCertificateSelection] = useState({ context: certificateContext, uuid: '' });
  const certificateRequest = certificateSelection.context === certificateContext ? certificateSelection.uuid : '';
  const setCertificateRequest = (uuid: string) => setCertificateSelection({ context: certificateContext, uuid });
  if (certificateSelection.context !== certificateContext) setCertificateRequest('');
  const certificateHeading = useRef<HTMLHeadingElement>(null);
  const certificateOpeners = useRef(new Map<string, HTMLButtonElement>());
  const certificateReturnFocus = useRef('');
  const invite = useRef<HTMLHeadingElement>(null);
  const inviteAction = useRef<HTMLDivElement>(null);
  const restoreInviteFocus = useRef(false);
  const shown = !!inviteMember && member?.uuid === inviteMember;
  const target = `${company}:${inviteMember}`;
  if (shown && invitationView.target !== target)
    setInvitationView({ open: true, target, receipt: access.invitationReceipt });
  useEffect(() => {
    if (inviting) {
      invite.current?.focus();
      invite.current?.scrollIntoView?.({ block: 'start' });
    } else if (restoreInviteFocus.current) {
      restoreInviteFocus.current = false;
      inviteAction.current?.querySelector('button')?.focus();
    }
  }, [inviting]);
  const invitations = access.access?.invitations ?? [];
  const associations = access.access?.associations ?? [];
  const particulars = access.requests?.particulars ?? [];
  const certificates = access.requests?.certificates ?? [];
  const certificateTarget = access.certificateTarget;
  const editCertificate = access.editCertificate;
  const certificatePreviewing = !!certificateTarget;
  const certificateOpen = !!certificateRequest || !!certificateTarget || access.retry?.kind === 'fulfil';
  const selectedCertificate = certificates.find(
    (item) => item.uuid === (certificateTarget?.preview.memberRequest ?? certificateRequest),
  );
  const certificateClass = registers.find((item) => item.token.uuid === selectedCertificate?.token)?.token;
  useEffect(() => {
    onEditingChange?.(certificateOpen);
    return () => onEditingChange?.(false);
  }, [certificateOpen, onEditingChange]);
  useEffect(() => {
    if (certificateOpen) {
      certificateHeading.current?.focus();
      certificateHeading.current?.scrollIntoView?.({ block: 'start' });
    } else if (certificateReturnFocus.current) {
      certificateOpeners.current.get(certificateReturnFocus.current)?.focus();
      certificateReturnFocus.current = '';
    }
  }, [certificateOpen, certificatePreviewing]);
  const selectedCertificateId = certificateTarget?.preview.memberRequest ?? certificateRequest;
  if (selectedCertificateId && access.requests && selectedCertificate?.status !== 'requested' && !held) {
    editCertificate();
    setCertificateRequest('');
  }
  const closeCertificate = () => {
    if (held) return;
    certificateReturnFocus.current = certificateRequest || certificateTarget?.preview.memberRequest || '';
    access.editCertificate();
    setCertificateRequest('');
    checks.reset();
  };
  const hasRecords = invitations.length + associations.length + particulars.length + certificates.length > 0;
  const selectedRequest = particulars.find((item) => item.uuid === request && item.status === 'submitted');
  return (
    <>
      <Section
        title={
          certificateOpen
            ? certificateTarget
              ? 'Review certificate'
              : 'Prepare certificate'
            : 'Member access and requests'
        }
      >
        <ErrorSummary {...checks.summary} />
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
        <Outcome>{access.notice}</Outcome>
        {access.retry && (
          <PageAction
            label="Retry original company member action"
            disabled={access.busy}
            onClick={() => void access.recover()}
          />
        )}
        {certificateOpen && (
          <div className="space-y-4">
            {selectedCertificate ? (
              <>
                <h3
                  ref={certificateHeading}
                  tabIndex={-1}
                  className="scroll-mt-6 text-base font-medium focus:outline-none"
                >
                  {memberName(selectedCertificate.member)}
                </h3>
                <div className="grid gap-4 text-sm sm:grid-cols-3">
                  <div>
                    <p className="text-text-muted">Share class</p>
                    <p className="mt-1 font-medium">
                      {certificateClass ? `${certificateClass.name} · ${certificateClass.symbol}` : 'Not available'}
                    </p>
                  </div>
                  <div>
                    <p className="text-text-muted">Requested</p>
                    <p className="mt-1">{formatDate(selectedCertificate.createdAt)}</p>
                  </div>
                  <div>
                    <p className="text-text-muted">Document</p>
                    <p className="mt-1">
                      Unsigned certificate{certificateTarget ? ` · ${certificateTarget.preview.pageCount} page` : ''}
                    </p>
                  </div>
                </div>
                {certificateTarget ? (
                  <>
                    <Disclosure summary="Record details">
                      <Rows>
                        <Row label="Entry">{certificateTarget.preview.sequence}</Row>
                        <Row label="Register sequence">{certificateTarget.preview.registerSequence}</Row>
                        <Row label="Company instruction">{certificateTarget.command.payload.instruction}</Row>
                        <Row label="Request reference">{shortReference(selectedCertificate.uuid)}</Row>
                        <Row label="Entry reference">{shortReference(certificateTarget.preview.entry)}</Row>
                        <Row label="Appointment reference">{shortReference(certificateTarget.preview.appointment)}</Row>
                        <Row label="Source fingerprint">{certificateTarget.preview.sourceDigest}</Row>
                      </Rows>
                    </Disclosure>
                    <p className="text-sm text-text-muted">
                      Unsigned PDF for this recipient only. The company arranges signing and permitted use.
                    </p>
                    <FormActions>
                      <PageAction label="Cancel" disabled={held} onClick={closeCertificate} />
                      <PageAction
                        label="Create certificate"
                        primary
                        busy={running === 'fulfil'}
                        busyLabel="Creating…"
                        disabled={held || selectedCertificate.status !== 'requested'}
                        onClick={() => track('fulfil', access.fulfilCertificate())}
                      />
                    </FormActions>
                  </>
                ) : (
                  <form
                    noValidate
                    className="space-y-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!held && selectedCertificate.status === 'requested' && checks.check(['instruction']))
                        track(
                          `preview:${selectedCertificate.uuid}`,
                          access.previewCertificate(selectedCertificate.uuid, certificateInstruction.trim()),
                        );
                    }}
                  >
                    <Field {...checks.field('instruction')} label="Company instruction">
                      <TextInput
                        value={certificateInstruction}
                        maxLength={FIELD_LIMITS.REFERENCE}
                        disabled={held}
                        onChange={(event) => setCertificateInstruction(event.target.value)}
                      />
                    </Field>
                    <FormActions>
                      <PageAction label="Cancel" disabled={held} onClick={closeCertificate} />
                      <PageAction
                        label="Preview"
                        type="submit"
                        primary
                        busy={running === `preview:${selectedCertificate.uuid}`}
                        busyLabel="Previewing…"
                        disabled={held || selectedCertificate.status !== 'requested'}
                      />
                    </FormActions>
                  </form>
                )}
              </>
            ) : (
              !access.readFailed && <Loading>Loading the current certificate request…</Loading>
            )}
          </div>
        )}
        <div hidden={(inviting && !!access.admin) || certificateOpen} className="space-y-4">
          {!access.readFailed && !access.requests && <Loading>Loading member access and requests…</Loading>}
          {!access.readFailed && access.requests && !hasRecords && (
            <p className="text-sm text-text-muted">
              {access.access ? 'No member access or requests yet.' : 'No member requests yet.'}
            </p>
          )}
          {invitations.length > 0 && (
            <div>
              <h3 className="text-base font-medium">Invitations</h3>
              <div className="divide-y divide-border-subtle">
                {invitations.map((item) => (
                  <Disclosure
                    key={item.uuid}
                    summary={
                      <span className="grid gap-1 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4">
                        <span className="min-w-0 break-words font-medium">
                          {memberName(item.member)}
                          <span className="block font-normal text-text-muted">{item.intendedEmail}</span>
                        </span>
                        <span className="text-text-muted">{MEMBER_INVITATION_STATUS_LABELS[item.status]}</span>
                      </span>
                    }
                  >
                    <Rows>
                      <Row label="Accept before">{formatDateTime(item.acceptanceDeadline)}</Row>
                      <Row label="Invitation reference">{shortReference(item.uuid)}</Row>
                      <Row label="Member reference">{shortReference(item.member)}</Row>
                    </Rows>
                  </Disclosure>
                ))}
              </div>
            </div>
          )}
          {associations.length > 0 && (
            <div className={invitations.length ? 'border-t border-border-subtle pt-4' : ''}>
              <h3 className="text-base font-medium">Current member access</h3>
              <div className="divide-y divide-border-subtle">
                {associations.map((association) => (
                  <Disclosure
                    key={association.uuid}
                    summary={
                      <span className="grid gap-1 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4">
                        <span className="font-medium">{memberName(association.member)}</span>
                        <span className="text-text-muted">
                          {association.current ? 'Current access' : 'Revoked access'}
                        </span>
                      </span>
                    }
                  >
                    <Rows>
                      <Row label="Member reference">{shortReference(association.member)}</Row>
                      <Row label="Account reference">{shortReference(association.userAccount)}</Row>
                      <Row label="Access reference">{shortReference(association.uuid)}</Row>
                    </Rows>
                    {association.current && revokeMember !== association.uuid && (
                      <FormActions>
                        <PageAction
                          label={`Revoke access for ${memberName(association.member)}`}
                          disabled={held}
                          onClick={() => {
                            checks.reset();
                            setRequest('');
                            setRevokeMember(association.uuid);
                          }}
                        />
                      </FormActions>
                    )}
                    {association.current && revokeMember === association.uuid && (
                      <form
                        noValidate
                        className="space-y-4"
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (!held && checks.check(['reason']))
                            setRevoking({ uuid: association.uuid, name: memberName(association.member) });
                        }}
                      >
                        <Field {...checks.field('reason')} label="Company action reason">
                          <TextArea
                            maxLength={FIELD_LIMITS.REASON}
                            value={reason}
                            disabled={held}
                            onChange={(event) => setReason(event.target.value)}
                          />
                        </Field>
                        <FormActions>
                          <PageAction
                            label="Cancel"
                            disabled={held}
                            onClick={() => {
                              checks.reset();
                              setRevokeMember('');
                            }}
                          />
                          <PageAction label="Revoke access" type="submit" disabled={held} />
                        </FormActions>
                      </form>
                    )}
                  </Disclosure>
                ))}
              </div>
            </div>
          )}
          {particulars.length > 0 && (
            <div className="border-t border-border-subtle pt-4">
              <h3 className="text-base font-medium">Particulars requests</h3>
              <div className="divide-y divide-border-subtle">
                {particulars.map((item) => (
                  <Disclosure
                    key={item.uuid}
                    summary={
                      <span className="grid gap-1 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4">
                        <span className="font-medium">{item.name}</span>
                        <span className="text-text-muted">{MEMBER_PARTICULARS_STATUS_LABELS[item.status]}</span>
                      </span>
                    }
                  >
                    <Rows>
                      <Row label="Residential address">{item.residentialAddress}</Row>
                      <Row label="Request reference">{shortReference(item.uuid)}</Row>
                      <Row label="Member reference">{shortReference(item.member)}</Row>
                      {item.change && <Row label="Company instruction">{shortReference(item.change)}</Row>}
                    </Rows>
                    {item.status === 'submitted' && access.prepare && (
                      <FormActions>
                        <PageAction
                          label={`Prepare particulars update for ${item.name}`}
                          disabled={held}
                          onClick={() => {
                            checks.reset();
                            setRevokeMember('');
                            setRequest(item.uuid);
                          }}
                        />
                      </FormActions>
                    )}
                  </Disclosure>
                ))}
              </div>
              {access.prepare && (
                <form
                  noValidate
                  hidden={!selectedRequest}
                  className="space-y-4 border-t border-border-subtle pt-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (selectedRequest && !held && checks.check(PARTICULARS_FIELDS)) track('particulars', prepare());
                  }}
                >
                  <h4 className="text-base font-medium">Prepare {selectedRequest?.name}&apos;s particulars update</h4>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FileField
                      {...checks.field('file')}
                      label="Company supporting document"
                      showUploadHint={false}
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
                  </div>
                  {selectedRequest && (
                    <Field {...checks.field('reason')} label="Company action reason">
                      <TextArea
                        maxLength={FIELD_LIMITS.REASON}
                        value={reason}
                        disabled={held}
                        onChange={(event) => setReason(event.target.value)}
                      />
                    </Field>
                  )}
                  <p className="text-sm text-text-muted">
                    This records the company instruction. Review and approve it separately in Ledger, Corrections.
                  </p>
                  {uploadError && (
                    <p role="alert" className="text-sm text-error-light">
                      {uploadError}
                    </p>
                  )}
                  <FormActions>
                    <PageAction
                      label="Cancel"
                      disabled={held}
                      onClick={() => {
                        checks.reset();
                        setRequest('');
                      }}
                    />
                    <PageAction
                      label="Record company particulars instruction"
                      type="submit"
                      primary
                      busy={running === 'particulars'}
                      busyLabel="Recording instruction…"
                      disabled={held}
                    />
                  </FormActions>
                </form>
              )}
            </div>
          )}
          {certificates.length > 0 && (
            <div className="space-y-4 border-t border-border-subtle pt-4">
              <h3 className="text-base font-medium">Certificate requests</h3>
              <div className="divide-y divide-border-subtle">
                {certificates.map((item) => (
                  <Disclosure
                    key={item.uuid}
                    summary={
                      <span className="grid gap-1 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4">
                        <span className="font-medium">{memberName(item.member)}</span>
                        <span className="text-text-muted">{MEMBER_CERTIFICATE_STATUS_LABELS[item.status]}</span>
                      </span>
                    }
                  >
                    <Rows>
                      <Row label="Request reference">{shortReference(item.uuid)}</Row>
                      <Row label="Member reference">{shortReference(item.member)}</Row>
                      <Row label="Entry reference">{shortReference(item.entry)}</Row>
                      {item.fulfilment && (
                        <>
                          <Row label="Unsigned PDF">{shortReference(item.fulfilment.uuid)}</Row>
                          <Row label="SHA-256">{item.fulfilment.digest}</Row>
                          <Row label="File size">{item.fulfilment.fileSize} bytes</Row>
                        </>
                      )}
                    </Rows>
                    {item.status === 'requested' && (
                      <FormActions>
                        <PageAction
                          ref={(element) => {
                            if (element) certificateOpeners.current.set(item.uuid, element);
                            else certificateOpeners.current.delete(item.uuid);
                          }}
                          label="Prepare certificate"
                          context={memberName(item.member)}
                          disabled={held}
                          onClick={() => {
                            checks.reset();
                            certificateReturnFocus.current = item.uuid;
                            setCertificateRequest(item.uuid);
                          }}
                        />
                      </FormActions>
                    )}
                  </Disclosure>
                ))}
              </div>
            </div>
          )}
        </div>
        {access.admin && (
          <form
            noValidate
            hidden={!inviting || certificateOpen}
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!held && recipientsReady && checks.check(INVITATION_FIELDS) && member)
                track('invite', access.invite(member.uuid, email.trim()));
            }}
          >
            <h3 ref={invite} tabIndex={-1} className="scroll-mt-6 text-base font-medium focus:outline-none">
              Invite a member
            </h3>
            <div className="grid items-start gap-4 sm:grid-cols-2">
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
              <Field {...checks.field('email')} label="Intended recipient email">
                <TextInput
                  maxLength={FIELD_LIMITS.EMAIL}
                  type="email"
                  value={email}
                  disabled={held}
                  onChange={(event) =>
                    setInvitation({ company, member: member?.uuid ?? '', email: event.target.value })
                  }
                />
              </Field>
            </div>
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
              <p className="text-sm text-text-muted">
                Record a member or employee award before inviting its recipient.
              </p>
            )}
            {member && (
              <Disclosure summary="Selected member record">
                <Rows>
                  <Row label="Member reference">{shortReference(member.uuid)}</Row>
                </Rows>
              </Disclosure>
            )}
            <p className="text-sm text-text-muted">
              Emails this person a link to accept access to their own shares and employee awards.
            </p>
            <FormActions>
              <PageAction
                label="Cancel"
                disabled={held}
                onClick={() => {
                  checks.reset();
                  restoreInviteFocus.current = true;
                  setInviting(false);
                }}
              />
              <PageAction
                label="Send invitation"
                type="submit"
                primary
                busy={running === 'invite'}
                busyLabel="Sending invitation…"
                disabled={held || !recipientsReady}
              />
            </FormActions>
          </form>
        )}
      </Section>
      {access.admin && !inviting && !certificateOpen && (
        <div ref={inviteAction} className="mt-4 flex flex-wrap justify-end gap-2">
          <PageAction
            label="Invite a member"
            primary
            disabled={held}
            onClick={() => {
              checks.reset();
              setInviting(true);
            }}
          />
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
            void Promise.resolve(access.revoke(revoking.uuid, reason.trim())).finally(() => {
              setRevoking(null);
              setRevokeMember('');
            })
          }
        >
          They lose access to their own records and files and can&apos;t make new requests, though they can still read
          the status of requests they made. Relinking needs a new invitation.
        </Confirmation>
      )}
    </>
  );
}
