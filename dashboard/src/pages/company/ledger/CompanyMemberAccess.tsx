import { Field, TextArea, TextInput } from '@components/Field';
import { useEffect, useRef, useState } from 'react';
import { useRunningAction } from '@hooks/useRunningAction';
import {
  FIELD_LIMITS,
  formatDate,
  formatDateTime,
  type OrderSubmissionOwner,
  type TokenHoldersResponse,
  MEMBER_INVITATION_STATUS_LABELS,
} from '@ledova/shared';
import { Outcome, Section, Loading, LoadError, Failure } from '@components/Ledger';
import { PersonSelect } from '@pages/company/ledger/shared/PersonPicker';
import { FormActions, PageAction } from '@components/Page';
import { Confirmation } from '@components/Modal';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { INVITATION_FIELDS, useMemberAccessForm } from './useMemberAccessForm';

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
    held,
    problems,
    refresh,
  } = useMemberAccessForm({ company, owner, guard, registers, sourceReady, inviteMember });
  const checks = useErrorSummary(problems);
  useEffect(() => {
    onHeldChange?.(held);
    return () => onHeldChange?.(false);
  }, [held, onHeldChange]);
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
  const deadline = (item: (typeof invitations)[number]) =>
    item.status === 'pending' || item.status === 'expired' ? (
      <>
        {item.status === 'pending' ? 'Accept before' : 'Deadline'}{' '}
        <span className="whitespace-nowrap">{formatDateTime(item.acceptanceDeadline)}</span>
      </>
    ) : null;
  return (
    <>
      <div className="space-y-4">
        <ErrorSummary {...checks.summary} />
        {access.readFailed && (
          <LoadError retry={() => track('refresh', refresh())} busy={running === 'refresh' || access.busy}>
            Member access could not be loaded.
          </LoadError>
        )}
        {(access.readFailed ? access.failure : access.error) && (
          <Failure>{access.readFailed ? access.failure : access.error}</Failure>
        )}
        <Outcome>{access.notice}</Outcome>
        {access.retry && (
          <PageAction
            label="Retry original company member action"
            disabled={access.busy}
            onClick={() => void access.recover()}
          />
        )}
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
                className="hidden grid-cols-[minmax(0,1fr)_10rem_12rem] gap-6 text-xs font-medium text-text-muted md:grid xl:grid-cols-[minmax(0,1fr)_10rem_12rem_10rem]"
              >
                <span>Person</span>
                <span>Linked</span>
                <span>Status</span>
                <span className="sr-only">Action</span>
              </div>
              <ul aria-label="Member access records" className="divide-y divide-border-subtle">
                {associations.map((association) => (
                  <li
                    key={association.uuid}
                    className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 py-4 text-sm md:grid-cols-[minmax(0,1fr)_10rem_12rem] md:gap-6 xl:grid-cols-[minmax(0,1fr)_10rem_12rem_10rem]"
                  >
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
                    {association.current && revokeMember !== association.uuid && (
                      <div className="col-span-2 flex items-start justify-end md:col-span-3 xl:col-span-1">
                        <PageAction
                          label="Revoke access"
                          context={`${memberName(association.member)}, ${association.acceptedEmail}`}
                          disabled={held}
                          onClick={() => {
                            checks.reset();
                            setReason('');
                            setRevokeMember(association.uuid);
                          }}
                        />
                      </div>
                    )}
                    {association.current && revokeMember === association.uuid && (
                      <form
                        noValidate
                        className="col-span-2 space-y-4 border-t border-border-subtle pt-4 md:col-span-3 xl:col-span-4"
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
                className="hidden grid-cols-[minmax(0,1fr)_10rem_12rem] gap-6 text-xs font-medium text-text-muted md:grid xl:grid-cols-[minmax(0,1fr)_10rem_12rem_10rem]"
              >
                <span>Person</span>
                <span>Invited</span>
                <span>Status</span>
              </div>
              <ul aria-label="Member invitations" className="divide-y divide-border-subtle">
                {invitations.map((item) => (
                  <li
                    key={item.uuid}
                    className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 py-4 text-sm md:grid-cols-[minmax(0,1fr)_10rem_12rem] md:gap-6 xl:grid-cols-[minmax(0,1fr)_10rem_12rem_10rem]"
                  >
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
                      {deadline(item) && <span className="hidden md:block">{deadline(item)}</span>}
                    </span>
                    {deadline(item) && <span className="col-span-2 text-text-muted md:hidden">{deadline(item)}</span>}
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
                  recipientsError && <Failure>{recipientsError}</Failure>
                )}
                {recipientsReady && candidates.length === 0 && (
                  <p className="text-sm text-text-muted">
                    Record a member or employee award before inviting its recipient.
                  </p>
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
          They lose access to their own records. Relinking needs a new invitation.
        </Confirmation>
      )}
    </>
  );
}
