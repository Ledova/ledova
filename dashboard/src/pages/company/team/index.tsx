import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  USER_PREFERENCES_QUERY_KEY,
  getCompanyTeam,
  getCompanyTeamInvitations,
  getErrorMessage,
  getOwnCompanyAppointments,
  readEveryPage,
  revokeCompanyAppointment,
  useSubmissionOwner,
  useUserPreferences,
  type CompanyTeamAppointment,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
} from '@ledova/shared';
import { FIELD_CLASS } from '@components/fieldClass';
import { Row, Rows, Section } from '@components/Ledger';
import { Modal } from '@components/Modal';
import { Page, PageAction } from '@components/Page';
import apiClient from '@services/apiClient';
import { AcceptInvitationForm } from './AcceptInvitationForm';
import { AppointmentRecord } from './AppointmentRecord';
import { TeamInvitationForm } from './TeamInvitationForm';
import { appointmentReceipt, currentAppointment, sameScope, scopeLabels } from './appointments';

export default function CompanyTeamPage() {
  const { owner, boundary } = useSubmissionOwner();
  const preferences = useUserPreferences();
  if (!owner || preferences.isError)
    return (
      <Page>
        <p className="text-sm text-text-muted">Your signed-in account must be checked before opening company team.</p>
        <PageAction label="Retry your account" onClick={() => void preferences.refetch()} />
      </Page>
    );
  return <OwnTeam key={`${owner.userUuid}/${owner.ownerAccountUuid}`} owner={owner} currentOwner={boundary.get} />;
}

function OwnTeam({
  owner,
  currentOwner,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
}) {
  const client = useQueryClient();
  const mounted = useRef(true);
  const guard = useCallback(() => {
    if (
      !mounted.current ||
      currentOwner() !== owner ||
      client.getQueryState(USER_PREFERENCES_QUERY_KEY)?.status !== 'success'
    )
      throw new Error('Your signed-in account changed. Reopen company team.');
  }, [client, currentOwner, owner]);
  const ownKey = ['company-appointments', owner.userUuid, owner.ownerAccountUuid];
  const invitationKey = ['company-team-invitations', owner.userUuid, owner.ownerAccountUuid];
  const [company, setCompany] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [formBusy, setFormBusy] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  type Confirmation = {
    ticket: symbol;
    appointment: OwnCompanyAppointment | CompanyTeamAppointment;
    companyName: string;
  };
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const ticket = useRef<symbol | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ticket.current = null;
    };
  }, []);
  const own = useQuery({
    queryKey: ownKey,
    queryFn: () =>
      readEveryPage(async (page) => {
        guard();
        const result = await getOwnCompanyAppointments(apiClient, page, { ledovaSubmissionGuard: guard });
        guard();
        return result;
      }),
  });
  const invitations = useQuery({
    queryKey: invitationKey,
    queryFn: () =>
      readEveryPage(async (page) => {
        guard();
        const result = await getCompanyTeamInvitations(apiClient, page, { ledovaSubmissionGuard: guard });
        guard();
        return result;
      }),
  });
  const appointments = own.isError ? [] : (own.data ?? []);
  const companies = [...new Map(appointments.map((item) => [item.company, item.companyName])).entries()];
  const sources = appointments.filter(
    (item) => item.company === company && currentAppointment(item) && item.delegatableCapabilities.length > 0,
  );
  const source = sources.find((item) => item.uuid === sourceId);
  const canAdmin =
    !own.isError &&
    !own.isFetching &&
    appointments.some(
      (item) => item.company === company && currentAppointment(item) && item.capabilities.includes('admin'),
    );
  const teamKey = ['company-team', owner.userUuid, owner.ownerAccountUuid, company];
  const team = useQuery({
    queryKey: teamKey,
    enabled: !!company && canAdmin,
    queryFn: async () => {
      guard();
      const result = await getCompanyTeam(apiClient, company, { ledovaSubmissionGuard: guard });
      guard();
      if (result.data.some((item) => item.company !== company))
        throw new Error('The company team outcome could not be confirmed.');
      return result.data;
    },
  });
  const disabled = formBusy || revoking;
  const close = () => {
    ticket.current = null;
    setConfirmation(null);
  };
  const canRevoke = (target: OwnCompanyAppointment | CompanyTeamAppointment) => {
    const key = 'name' in target ? teamKey : ownKey;
    const state = client.getQueryState(key);
    const rows = client.getQueryData<(OwnCompanyAppointment | CompanyTeamAppointment)[]>(key);
    const latest = rows?.find((item) => item.uuid === target.uuid && item.company === target.company);
    const authority = client.getQueryData<OwnCompanyAppointment[]>(ownKey) ?? [];
    return (
      state?.status === 'success' &&
      state.fetchStatus === 'idle' &&
      latest?.status !== 'revoked' &&
      !!latest &&
      (!('name' in target) ||
        (client.getQueryState(ownKey)?.status === 'success' &&
          client.getQueryState(ownKey)?.fetchStatus === 'idle' &&
          authority.some(
            (item) =>
              item.company === target.company && currentAppointment(item) && item.capabilities.includes('admin'),
          )))
    );
  };
  const confirm = (appointment: OwnCompanyAppointment | CompanyTeamAppointment, companyName: string) => {
    if (disabled || ticket.current || !canRevoke(appointment)) return;
    ticket.current = Symbol();
    setConfirmation({ ticket: ticket.current, appointment, companyName });
  };
  const revoke = async (target: OwnCompanyAppointment | CompanyTeamAppointment) => {
    if (pending.current) return;
    pending.current = true;
    setRevoking(true);
    setError('');
    try {
      const check = () => {
        guard();
        if (!canRevoke(target)) throw new Error('Your company appointment changed. Refresh before revoking it.');
      };
      check();
      const { data } = await revokeCompanyAppointment(apiClient, target.uuid, { ledovaSubmissionGuard: check });
      guard();
      if (
        !appointmentReceipt(data) ||
        data.uuid !== target.uuid ||
        data.company !== target.company ||
        data.source !== target.source ||
        data.status !== 'revoked' ||
        !data.revokedAt ||
        data.isEffective ||
        !sameScope(data.capabilities, target.capabilities) ||
        !sameScope(data.delegatableCapabilities, target.delegatableCapabilities) ||
        data.createdAt !== target.createdAt ||
        data.expiresAt !== target.expiresAt
      )
        throw new Error('The revocation outcome could not be confirmed. Refresh your appointments or retry.');
      await Promise.all([
        client.cancelQueries({ queryKey: ownKey, exact: true }),
        client.cancelQueries({ queryKey: teamKey, exact: true }),
      ]);
      guard();
      if (client.getQueryState(ownKey)?.status !== 'error')
        client.setQueryData<OwnCompanyAppointment[]>(ownKey, (previous) =>
          previous?.map((item) => (item.uuid === data.uuid ? data : item)),
        );
      if (client.getQueryState(teamKey)?.status !== 'error')
        client.setQueryData<CompanyTeamAppointment[]>(teamKey, (previous) =>
          previous?.map((item) =>
            item.uuid === data.uuid
              ? { ...item, status: data.status, revokedAt: data.revokedAt, isEffective: false }
              : item,
          ),
        );
    } catch (failure) {
      try {
        guard();
        setError(
          getErrorMessage(failure, 'The appointment could not be revoked. Refresh or retry.') ??
            'The appointment could not be revoked. Refresh or retry.',
        );
      } catch {
        return;
      }
    } finally {
      pending.current = false;
      if (mounted.current) setRevoking(false);
    }
  };
  const issueGuard = () => {
    guard();
    const latest = client.getQueryData<OwnCompanyAppointment[]>(ownKey) ?? [];
    const current = latest.find((item) => item.uuid === source?.uuid && item.company === company);
    const administrator = latest.some(
      (item) => item.company === company && currentAppointment(item) && item.capabilities.includes('admin'),
    );
    if (
      client.getQueryState(ownKey)?.status !== 'success' ||
      client.getQueryState(ownKey)?.fetchStatus !== 'idle' ||
      !current ||
      !currentAppointment(current) ||
      !source ||
      !sameScope(current.delegatableCapabilities, source.delegatableCapabilities) ||
      (canAdmin && !administrator)
    )
      throw new Error('Your company appointment changed. Refresh and select a current source.');
  };
  const companyName = companies.find(([uuid]) => uuid === company)?.[1] ?? '';
  return (
    <Page>
      <p className="text-sm text-text-muted">
        Company information is provided by the company. Appointments give only their recorded actions; they do not
        activate a company or approve a register change.
      </p>
      <Section title="Accept a company invitation">
        <AcceptInvitationForm
          disabled={disabled}
          guard={guard}
          onBusy={setFormBusy}
          onRecorded={() => {
            void own.refetch();
            void invitations.refetch();
          }}
        />
      </Section>
      <Section title="Your appointments">
        <PageAction
          label="Refresh appointments"
          disabled={disabled || own.isFetching}
          onClick={() => void own.refetch()}
        />
        {own.isPending ? (
          <p role="status">Loading your appointments…</p>
        ) : own.isError ? (
          <p role="alert" className="text-sm text-error-light">
            Your appointments could not be loaded. Refresh before using company authority.
          </p>
        ) : appointments.length === 0 ? (
          <p>No company appointments recorded.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {appointments.map((item) => (
              <AppointmentRecord
                key={item.uuid}
                appointment={item}
                companyName={item.companyName}
                disabled={disabled || own.isFetching}
                onRevoke={() => confirm(item, item.companyName)}
              />
            ))}
          </ul>
        )}
      </Section>
      <Section title="Invite and manage a company team">
        <label className="block space-y-1 text-sm text-text-primary">
          Company
          <select
            className={FIELD_CLASS}
            value={company}
            disabled={disabled || own.isFetching || own.isError}
            onChange={(event) => {
              close();
              setCompany(event.target.value);
              setSourceId('');
            }}
          >
            <option value="">Select a company from your appointments</option>
            {companies.map(([uuid, name]) => (
              <option key={uuid} value={uuid}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {company && (
          <>
            <label className="block space-y-1 text-sm text-text-primary">
              Delegating appointment
              <select
                className={FIELD_CLASS}
                value={sourceId}
                disabled={disabled || own.isFetching}
                onChange={(event) => setSourceId(event.target.value)}
              >
                <option value="">Select a current appointment</option>
                {sources.map((item) => (
                  <option key={item.uuid} value={item.uuid}>
                    {item.uuid} · {scopeLabels(item.delegatableCapabilities)}
                  </option>
                ))}
              </select>
            </label>
            {sources.length === 0 && <p>No current appointment can delegate actions for this company.</p>}
            {source && !own.isFetching && (
              <TeamInvitationForm
                key={source.uuid}
                source={source}
                available={source.delegatableCapabilities.filter((value) => value !== 'admin' || canAdmin)}
                disabled={disabled}
                guard={issueGuard}
                onBusy={setFormBusy}
                onRecorded={() => void invitations.refetch()}
              />
            )}
            {canAdmin ? (
              <>
                <h3 className="text-sm font-medium">Company team</h3>
                <PageAction
                  label="Refresh company team"
                  disabled={disabled || team.isFetching}
                  onClick={() => void team.refetch()}
                />
                {team.isPending ? (
                  <p role="status">Loading company team…</p>
                ) : team.isError ? (
                  <p role="alert" className="text-sm text-error-light">
                    Company team could not be loaded. Refresh before managing it.
                  </p>
                ) : (
                  <ul className="divide-y divide-border-subtle">
                    {(team.data ?? []).map((item) => (
                      <AppointmentRecord
                        key={item.uuid}
                        appointment={item}
                        companyName={companyName}
                        teamRecord
                        disabled={disabled || team.isFetching}
                        onRevoke={() => confirm(item, companyName)}
                      />
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p>Current personal Manage company team authority is required to read or change other appointments.</p>
            )}
          </>
        )}
      </Section>
      <Section title="Invitations you issued">
        <PageAction
          label="Refresh invitations"
          disabled={disabled || invitations.isFetching}
          onClick={() => void invitations.refetch()}
        />
        {invitations.isPending ? (
          <p role="status">Loading your invitations…</p>
        ) : invitations.isError ? (
          <p role="alert" className="text-sm text-error-light">
            Your invitations could not be loaded.
          </p>
        ) : (invitations.data ?? []).length === 0 ? (
          <p>No invitations recorded.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {(invitations.data ?? []).map((item) => (
              <li key={item.uuid} className="py-3">
                <Rows>
                  <Row label="Company (provided by the company)">{item.companyName}</Row>
                  <Row label="Invitation">{item.uuid}</Row>
                  <Row label="Personal actions">{scopeLabels(item.capabilities)}</Row>
                  <Row label="May delegate">{scopeLabels(item.delegatableCapabilities)}</Row>
                  <Row label="Acceptance deadline">{item.acceptanceDeadline}</Row>
                  <Row label="Accepted">{item.acceptedAt || 'Not yet accepted'}</Row>
                  <Row label="Appointment expiry">{item.appointmentExpiresAt || 'No expiry'}</Row>
                </Rows>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {error && (
        <p role="alert" className="text-sm text-error-light">
          {error}
        </p>
      )}
      <Modal
        isOpen={!!confirmation}
        onClose={close}
        title="Revoke appointment permanently?"
        showFooter
        confirmLabel="Permanently revoke appointment"
        confirmDisabled={!confirmation || disabled || !canRevoke(confirmation.appointment)}
        onConfirm={() => {
          if (
            !confirmation ||
            ticket.current !== confirmation.ticket ||
            disabled ||
            !canRevoke(confirmation.appointment)
          )
            return;
          const target = confirmation.appointment;
          close();
          void revoke(target);
        }}
      >
        <p className="text-sm text-text-primary">
          Permanently remove appointment {confirmation?.appointment.uuid} for {confirmation?.companyName}? This
          appointment loses its company authority. Its declaration and history remain retained. Another initial
          self-declaration cannot restore it; revoking an initial appointment does not reopen admission.
        </p>
      </Modal>
    </Page>
  );
}
