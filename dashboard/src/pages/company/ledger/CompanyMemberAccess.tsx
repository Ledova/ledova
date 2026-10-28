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
  searchRows,
} from '@ledova/shared';
import { Outcome, Section, Loading, LoadError, Disclosure, Rows, Row } from '@components/Ledger';
import { PersonSelect } from '@pages/company/ledger/shared/PersonPicker';
import { FormActions, PageAction, PageActions } from '@components/Page';
import { Confirmation } from '@components/Modal';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { useListParams } from '@hooks/useListParams';
import { FilterPopover } from '@components/FilterPopover';
import { SelectField } from '@components/SelectField';
import { INVITATION_FIELDS, PARTICULARS_FIELDS, useCompanyMemberRequests } from './useCompanyMemberRequests';

export function CompanyMemberAccess({
  view,
  company,
  owner,
  guard,
  registers,
  sourceReady = true,
  visible = true,
  inviteMember,
  onHeldChange,
}: {
  view: 'access' | 'requests';
  company: string;
  owner: OrderSubmissionOwner;
  guard: () => void;
  registers: TokenHoldersResponse[];
  sourceReady?: boolean;
  visible?: boolean;
  inviteMember?: string;
  onHeldChange?: (held: boolean, view: 'access' | 'requests') => void;
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
  } = useCompanyMemberRequests({ company, owner, guard, registers, sourceReady, inviteMember });
  const checks = useErrorSummary(problems);
  const filters = useListParams(['request_type']);
  const [heldView, setHeldView] = useState(view);
  if (!held && heldView !== view) {
    setHeldView(view);
    checks.reset();
  }
  useEffect(() => {
    onHeldChange?.(held, heldView);
    return () => onHeldChange?.(false, heldView);
  }, [held, heldView, onHeldChange]);
  const candidateOf = new Map(candidates.map((candidate) => [candidate.uuid, candidate]));
  const { running, track } = useRunningAction();
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
  const requestHeading = useRef<HTMLHeadingElement>(null);
  const requestOpeners = useRef(new Map<string, HTMLButtonElement>());
  const requestReturnFocus = useRef('');
  const invite = useRef<HTMLHeadingElement>(null);
  const inviteAction = useRef<HTMLDivElement>(null);
  const restoreInviteFocus = useRef(false);
  const shown = !!inviteMember && member?.uuid === inviteMember;
  const target = `${company}:${inviteMember}`;
  if (shown && invitationView.target !== target)
    setInvitationView({ open: true, target, receipt: access.invitationReceipt });
  useEffect(() => {
    if (view !== 'access') return;
    if (inviting) {
      invite.current?.focus();
      invite.current?.scrollIntoView?.({ block: 'start' });
    } else if (restoreInviteFocus.current) {
      restoreInviteFocus.current = false;
      inviteAction.current?.querySelector('button')?.focus();
    }
  }, [inviting, view]);
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
    if (view !== 'requests') return;
    if (certificateOpen) {
      certificateHeading.current?.focus();
      certificateHeading.current?.scrollIntoView?.({ block: 'start' });
    } else if (certificateReturnFocus.current) {
      certificateOpeners.current.get(certificateReturnFocus.current)?.focus();
      certificateReturnFocus.current = '';
    }
  }, [certificateOpen, certificatePreviewing, view]);
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
  const hasRequests = particulars.length + certificates.length > 0;
  const selectedRequest = particulars.find((item) => item.uuid === request && item.status === 'submitted');
  const requestOpen = !!selectedRequest && !!access.prepare;
  useEffect(() => {
    if (view !== 'requests' || certificateOpen) return;
    if (requestOpen) {
      requestHeading.current?.focus();
      requestHeading.current?.scrollIntoView?.({ block: 'start' });
    } else if (!request && requestReturnFocus.current) {
      const opener = requestOpeners.current.get(requestReturnFocus.current);
      if (opener) {
        opener.focus();
        requestReturnFocus.current = '';
      }
    }
  }, [requestOpen, request, view, certificateOpen]);
  const memberRequests = [
    ...particulars.map((record) => ({ kind: 'particulars' as const, record })),
    ...certificates.map((record) => ({ kind: 'certificate' as const, record })),
  ];
  const requestType = ['particulars', 'certificate'].includes(filters.filters.request_type)
    ? filters.filters.request_type
    : '';
  const filtersHeld = held || requestOpen || certificateOpen || !access.requests;
  useEffect(() => {
    if (filtersHeld && filters.typed !== filters.search) filters.type(filters.search);
  }, [filtersHeld, filters.typed, filters.search, filters.type]);
  const matches = filtersHeld
    ? memberRequests
    : searchRows(
        memberRequests,
        (item) => (item.kind === 'particulars' ? item.record.name : memberName(item.record.member)),
        filters.search,
      ).filter((item) => !requestType || item.kind === requestType);
  const matchingRequests = new Set(matches.map((item) => `${item.kind}/${item.record.uuid}`));
  return (
    <>
      <div className="space-y-4">
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
        <div hidden={view !== 'requests' || !certificateOpen}>
          <Section title={certificateTarget ? 'Review certificate' : 'Prepare certificate'}>
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
                          Unsigned certificate
                          {certificateTarget ? ` · ${certificateTarget.preview.pageCount} page` : ''}
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
                            <Row label="Appointment reference">
                              {shortReference(certificateTarget.preview.appointment)}
                            </Row>
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
          </Section>
        </div>
        <div hidden={view !== 'access'} className="space-y-4">
          <div hidden={inviting} className="space-y-4">
            {!access.readFailed && (!access.access || associations.length === 0) && (
              <Section title="People">
                {!access.access ? (
                  access.readable && !access.canAdminister ? (
                    <p className="text-sm text-text-muted">A company administrator manages member access.</p>
                  ) : (
                    <Loading>Loading member access…</Loading>
                  )
                ) : (
                  <p className="text-sm text-text-muted">No member access yet.</p>
                )}
              </Section>
            )}
            {associations.length > 0 && (
              <Section title="People">
                <div
                  aria-hidden="true"
                  className="hidden grid-cols-[minmax(0,1fr)_10rem_12rem] gap-6 pl-7 text-xs font-medium text-text-muted md:grid"
                >
                  <span>Person</span>
                  <span>Linked</span>
                  <span>Status</span>
                </div>
                <ul aria-label="Member access records" className="divide-y divide-border-subtle">
                  {associations.map((association) => (
                    <li key={association.uuid}>
                      <Disclosure
                        summary={
                          <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-sm md:grid-cols-[minmax(0,1fr)_10rem_12rem] md:gap-6">
                            <span className="min-w-0 break-words font-medium">
                              {memberName(association.member)}
                              <span className="block font-normal text-text-muted">{association.acceptedEmail}</span>
                            </span>
                            <span className="col-start-1 row-start-2 tabular-nums text-text-muted md:col-auto md:row-auto">
                              <span className="md:sr-only">Linked: </span>
                              {formatDate(association.createdAt)}
                            </span>
                            <span className="col-start-2 row-start-1 min-w-0 break-words text-text-muted md:col-auto md:row-auto">
                              {association.current ? 'Current access' : 'Revoked access'}
                            </span>
                          </span>
                        }
                      >
                        <Disclosure summary="Technical details">
                          <Rows>
                            <Row label="Member reference">{shortReference(association.member)}</Row>
                            <Row label="Account reference">{shortReference(association.userAccount)}</Row>
                            <Row label="Access reference">{shortReference(association.uuid)}</Row>
                          </Rows>
                        </Disclosure>
                        {association.current && revokeMember !== association.uuid && (
                          <FormActions>
                            <PageAction
                              label="Revoke access"
                              context={memberName(association.member)}
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
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            {!access.readFailed && access.access && invitations.length === 0 && (
              <Section title="Invitations">
                <p className="text-sm text-text-muted">No invitations yet.</p>
              </Section>
            )}
            {invitations.length > 0 && (
              <Section title="Invitations">
                <div
                  aria-hidden="true"
                  className="hidden grid-cols-[minmax(0,1fr)_10rem_12rem] gap-6 pl-7 text-xs font-medium text-text-muted md:grid"
                >
                  <span>Person</span>
                  <span>Invited</span>
                  <span>Status</span>
                </div>
                <ul aria-label="Member invitations" className="divide-y divide-border-subtle">
                  {invitations.map((item) => (
                    <li key={item.uuid}>
                      <Disclosure
                        summary={
                          <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-sm md:grid-cols-[minmax(0,1fr)_10rem_12rem] md:gap-6">
                            <span className="min-w-0 break-words font-medium">
                              {memberName(item.member)}
                              <span className="block font-normal text-text-muted">{item.intendedEmail}</span>
                            </span>
                            <span className="col-start-1 row-start-2 tabular-nums text-text-muted md:col-auto md:row-auto">
                              <span className="md:sr-only">Invited: </span>
                              {formatDate(item.createdAt)}
                            </span>
                            <span className="col-start-2 row-start-1 min-w-0 break-words text-text-muted md:col-auto md:row-auto">
                              {MEMBER_INVITATION_STATUS_LABELS[item.status]}
                            </span>
                          </span>
                        }
                      >
                        <Rows>
                          <Row label="Accept before">{formatDateTime(item.acceptanceDeadline)}</Row>
                        </Rows>
                        <Disclosure summary="Technical details">
                          <Rows>
                            <Row label="Invitation reference">{shortReference(item.uuid)}</Row>
                            <Row label="Member reference">{shortReference(item.member)}</Row>
                          </Rows>
                        </Disclosure>
                      </Disclosure>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </div>
          <div hidden={!inviting}>
            <Section title="Invite a member">
              {access.admin && (
                <form
                  noValidate
                  hidden={!inviting}
                  className="space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!held && recipientsReady && checks.check(INVITATION_FIELDS) && member)
                      track('invite', access.invite(member.uuid, email.trim()));
                  }}
                >
                  <h3 ref={invite} tabIndex={-1} className="sr-only scroll-mt-6 focus:outline-none">
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
                          ? [
                              candidate.classes.join(', '),
                              ...(person.awardOnly ? [] : [candidate.sources.join(', ')]),
                            ].join(' · ')
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
                    <Disclosure summary="Technical details">
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
          </div>
          {access.admin && !inviting && (
            <div ref={inviteAction} className="flex flex-wrap justify-end gap-2">
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
        </div>
        <div hidden={view !== 'requests' || certificateOpen}>
          <Section title="Requests">
            {visible && view === 'requests' && !certificateOpen && (
              <PageActions>
                <FilterPopover active={!!filters.search || !!requestType} resetKey={certificateContext}>
                  {(close) => (
                    <>
                      <Field label="Person">
                        <TextInput
                          type="search"
                          maxLength={100}
                          autoComplete="off"
                          data-1p-ignore
                          disabled={filtersHeld}
                          value={filters.typed}
                          onChange={(event) => {
                            if (!filtersHeld) filters.type(event.target.value);
                          }}
                        />
                      </Field>
                      <SelectField
                        label="Request type"
                        options={[
                          { value: '', label: 'All requests' },
                          { value: 'particulars', label: 'Details update' },
                          { value: 'certificate', label: 'Certificate' },
                        ]}
                        value={requestType}
                        disabled={filtersHeld}
                        onChange={(value) => {
                          if (filtersHeld) return;
                          close();
                          filters.setFilter('request_type', value);
                        }}
                      />
                    </>
                  )}
                </FilterPopover>
              </PageActions>
            )}
            {!access.readFailed && !access.requests && <Loading>Loading member requests…</Loading>}
            {!access.readFailed && access.requests && !hasRequests && (
              <p className="text-sm text-text-muted">No member requests yet.</p>
            )}
            {hasRequests && matches.length === 0 && (
              <p role="status" className="text-sm text-text-muted">
                No member requests match these filters.
              </p>
            )}
            {matches.length > 0 && (
              <div
                aria-hidden="true"
                className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem_10rem] gap-6 pl-7 text-xs font-medium text-text-muted lg:grid"
              >
                <span>Person</span>
                <span>Request</span>
                <span>Requested</span>
                <span>Status</span>
              </div>
            )}
            <ul aria-label="Member requests" className={requestOpen ? '' : 'divide-y divide-border-subtle'}>
              {memberRequests.map((item) => {
                const record = item.record;
                const shareClass =
                  item.kind === 'certificate'
                    ? registers.find((register) => register.token.uuid === item.record.token)?.token
                    : undefined;
                return (
                  <li
                    key={`${item.kind}/${record.uuid}`}
                    hidden={
                      !matchingRequests.has(`${item.kind}/${record.uuid}`) ||
                      (!!selectedRequest &&
                        !!access.prepare &&
                        (item.kind !== 'particulars' || item.record.uuid !== selectedRequest.uuid))
                    }
                  >
                    <Disclosure
                      summary={
                        <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-sm lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem_10rem] lg:gap-6">
                          <span className="min-w-0 break-words font-medium">
                            {item.kind === 'particulars' ? item.record.name : memberName(item.record.member)}
                          </span>
                          <span className="col-span-2 min-w-0 break-words text-text-muted lg:col-span-1">
                            <span className="sr-only">Request: </span>
                            {item.kind === 'particulars' ? 'Details update' : 'Unsigned certificate'}
                            {shareClass && (
                              <span className="block">
                                {shareClass.name} · {shareClass.symbol}
                              </span>
                            )}
                          </span>
                          <span className="col-span-2 tabular-nums text-text-muted lg:col-span-1">
                            <span className="lg:sr-only">Requested: </span>
                            {formatDate(record.createdAt)}
                          </span>
                          <span className="col-start-2 row-start-1 min-w-0 break-words text-text-muted lg:col-auto lg:row-auto">
                            {item.kind === 'particulars'
                              ? MEMBER_PARTICULARS_STATUS_LABELS[item.record.status]
                              : MEMBER_CERTIFICATE_STATUS_LABELS[item.record.status]}
                          </span>
                        </span>
                      }
                    >
                      {item.kind === 'particulars' ? (
                        <>
                          <Rows>
                            <Row label="Residential address">{item.record.residentialAddress}</Row>
                          </Rows>
                          {item.record.status === 'submitted' &&
                            access.prepare &&
                            selectedRequest?.uuid !== item.record.uuid && (
                              <FormActions>
                                <PageAction
                                  ref={(element) => {
                                    if (element) requestOpeners.current.set(item.record.uuid, element);
                                    else requestOpeners.current.delete(item.record.uuid);
                                  }}
                                  label="Prepare update"
                                  context={item.record.name}
                                  disabled={held}
                                  onClick={() => {
                                    checks.reset();
                                    setRevokeMember('');
                                    requestReturnFocus.current = item.record.uuid;
                                    setRequest(item.record.uuid);
                                  }}
                                />
                              </FormActions>
                            )}
                        </>
                      ) : (
                        <>
                          {item.record.fulfilment && (
                            <Rows>
                              <Row label="Created on">{formatDate(item.record.fulfilment.createdAt)}</Row>
                            </Rows>
                          )}
                          <Disclosure summary="Technical details">
                            <Rows>
                              <Row label="Request reference">{shortReference(item.record.uuid)}</Row>
                              <Row label="Member reference">{shortReference(item.record.member)}</Row>
                              <Row label="Entry reference">{shortReference(item.record.entry)}</Row>
                              {item.record.fulfilment && (
                                <>
                                  <Row label="Unsigned PDF">{shortReference(item.record.fulfilment.uuid)}</Row>
                                  <Row label="SHA-256">{item.record.fulfilment.digest}</Row>
                                  <Row label="File size">{item.record.fulfilment.fileSize} bytes</Row>
                                </>
                              )}
                            </Rows>
                          </Disclosure>
                          {item.record.status === 'requested' && (
                            <FormActions>
                              <PageAction
                                ref={(element) => {
                                  if (element) certificateOpeners.current.set(item.record.uuid, element);
                                  else certificateOpeners.current.delete(item.record.uuid);
                                }}
                                label="Prepare certificate"
                                context={memberName(item.record.member)}
                                disabled={held}
                                onClick={() => {
                                  checks.reset();
                                  certificateReturnFocus.current = item.record.uuid;
                                  setCertificateRequest(item.record.uuid);
                                }}
                              />
                            </FormActions>
                          )}
                        </>
                      )}
                    </Disclosure>
                  </li>
                );
              })}
            </ul>
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
                <h3 ref={requestHeading} tabIndex={-1} className="scroll-mt-6 text-base font-medium focus:outline-none">
                  Prepare {selectedRequest?.name}&apos;s particulars update
                </h3>
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
          </Section>
        </div>
      </div>
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
