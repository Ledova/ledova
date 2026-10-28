import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DESTINATIONS,
  REGISTER_AWARD_COPY as COPY,
  appointmentForRegisterStep,
  formatDate,
  hasCurrentRegisterReadAuthority,
  useSubmissionOwner,
  useUserPreferences,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
} from '@ledova/shared';
import { LoadError, Loading } from '@components/Ledger';
import { Page, PageLink } from '@components/Page';
import { PageTitle } from '@components/PageTitle';
import { useLedgerNavigation } from '@components/LedgerNavigation';
import { ownerGuard } from '@pages/company/shared/ownerGuard';
import { registersQuery } from '@pages/company/shared/useCompanyRegister';
import { useRegisterClasses } from '@hooks/useRegisterClasses';
import { useOwnAppointments } from '@hooks/useOwnAppointments';
import { registerKey } from '@hooks/useRegisterAccess';
import { allPeopleKey } from '@pages/company/ledger/shared/usePeople';
import { useRecordCompany } from '@pages/company/ledger/shared/useRecordCompany';
import { awardsKey, useRegisterAward } from '@pages/company/ledger/shared/useRegisterAwards';
import { grantsKey, useRegisterGrants } from '@pages/company/ledger/shared/useRegisterGrants';
import { shareholderPath } from '@pages/company/ledger/shared/shareholders';
import { AwardRecord } from '../AwardRecord';

export default function CompanyRegisterAwardPage() {
  const { uuid: token = '', award = '' } = useParams();
  const { owner, boundary } = useSubmissionOwner();
  const preferences = useUserPreferences();
  if (owner)
    return (
      <OwnAward
        key={`${owner.userUuid}/${owner.ownerAccountUuid}/${token}/${award}`}
        owner={owner}
        currentOwner={boundary.get}
        token={token}
        uuid={award}
      />
    );
  return (
    <Page>
      {preferences.isLoading ? (
        <Loading>Loading your account…</Loading>
      ) : (
        <LoadError retry={() => preferences.refetch()} busy={preferences.isFetching}>
          Your account could not be loaded.
        </LoadError>
      )}
    </Page>
  );
}

function OwnAward({
  owner,
  currentOwner,
  token,
  uuid,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  token: string;
  uuid: string;
}) {
  const client = useQueryClient();
  const { setState: setLedgerNavigation } = useLedgerNavigation();
  const guard = useMemo(() => ownerGuard(owner, currentOwner), [owner, currentOwner]);
  const classes = useRegisterClasses(owner, guard);
  const listed = classes.data?.find((item) => item.uuid === token);
  const company = listed?.companyUuid ?? '';
  const companyMatches = useRecordCompany(listed?.companyUuid, guard);
  const appointments = useOwnAppointments(owner, guard, { enabled: !!company });
  const latestAppointments = useRef<OwnCompanyAppointment[]>([]);
  useLayoutEffect(() => {
    latestAppointments.current = appointments.isSuccess ? appointments.data : [];
  }, [appointments.isSuccess, appointments.data]);
  const live = useRef(true);
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const check = useMemo(
    () => () => {
      guard();
      if (!live.current) throw new Error('This award is no longer open.');
      if (!hasCurrentRegisterReadAuthority(latestAppointments.current, company))
        throw new Error('A current company register appointment is required.');
    },
    [guard, company],
  );
  const readable =
    !!company &&
    companyMatches &&
    appointments.isSuccess &&
    hasCurrentRegisterReadAuthority(appointments.data, company);
  const registers = useQuery(registersQuery(owner, readable ? [token] : [], guard));
  const award = useRegisterAward(owner, company, token, uuid, check, readable);
  const grants = useRegisterGrants(owner, company, token, check, readable);
  const register = registers.data?.[0];
  const supported = !!register?.initialized && register.token.status === 'draft';
  const appointment = readable ? appointmentForRegisterStep(appointments.data, company, 'prepare') : undefined;
  const [held, setHeld] = useState(false);
  const blocked = !readable || award.isFetching || award.isError || appointments.isFetching || appointments.isError;
  const visible = readable && award.isSuccess && !award.isFetching && !appointments.isFetching && !appointments.isError;
  useEffect(() => {
    setLedgerNavigation({
      company: company || undefined,
      token,
      shareholderView: 'awards',
      blocked: held,
      held,
    });
    return () => setLedgerNavigation(null);
  }, [setLedgerNavigation, company, token, held]);
  const refresh = async () => {
    check();
    await award.refetch({ throwOnError: true });
    check();
    await Promise.all([
      client.invalidateQueries({ queryKey: awardsKey(owner, token), exact: true }),
      client.invalidateQueries({ queryKey: grantsKey(owner, token) }),
      client.invalidateQueries({ queryKey: allPeopleKey(owner) }),
      client.invalidateQueries({ queryKey: [...registerKey(owner), 'invitation-awards', company] }),
      client.invalidateQueries({ queryKey: [...registerKey(owner), 'member-awards', company] }),
    ]);
  };

  let content: ReactNode;
  if (classes.isError)
    content = (
      <LoadError retry={() => classes.refetch()} busy={classes.isFetching}>
        The register could not be loaded.
      </LoadError>
    );
  else if (!classes.data) content = <Loading>Loading the register…</Loading>;
  else if (!listed) content = <p className="text-sm text-text-muted">This share class is not in your register.</p>;
  else if (appointments.isError)
    content = (
      <LoadError retry={() => appointments.refetch()} busy={appointments.isFetching}>
        Your appointments could not be loaded.
      </LoadError>
    );
  else if (!appointments.isSuccess || !companyMatches) content = <Loading>Loading your appointments…</Loading>;
  else if (!readable)
    content = (
      <p className="text-sm text-text-muted">
        A current company register appointment is required to read employee awards.
      </p>
    );
  else if (award.isError)
    content = (
      <LoadError retry={() => award.refetch()} busy={award.isFetching}>
        This employee award could not be loaded.
      </LoadError>
    );
  else if (!award.data) content = <Loading>Loading the employee award…</Loading>;
  else content = null;

  const title = visible && award.data ? award.data.recipientName : DESTINATIONS.companyRegisterAward.title;
  return (
    <PageTitle.Provider value={title}>
      <Page
        documentTitle={DESTINATIONS.companyRegisterAward.title}
        lede={
          visible && award.data && register
            ? `Employee award · ${register.token.name} · ${register.token.symbol} · Agreement ${formatDate(award.data.termsOn)}`
            : undefined
        }
        back={{ state: company ? { registerCompany: company, registerToken: token } : undefined }}
        actions={
          visible &&
          award.data && (
            <PageLink
              to={shareholderPath(award.data.member, company)}
              label="Recipient details"
              context={award.data.recipientName}
            />
          )
        }
      >
        {content}
        {readable && !appointment && <p className="text-sm text-text-muted">{COPY.READ_ONLY_NOTE}</p>}
        {registers.isError && (
          <LoadError retry={() => registers.refetch()} busy={registers.isFetching}>
            The share class could not be loaded.
          </LoadError>
        )}
        {grants.isError && (
          <LoadError retry={() => grants.refetch()} busy={grants.isFetching}>
            The non-paid issues prepared from this award could not be loaded.
          </LoadError>
        )}
        {award.data && (
          <AwardRecord
            owner={owner}
            award={award.data}
            grants={grants.isSuccess ? grants.data.filter((grant) => grant.award === uuid) : []}
            appointment={supported ? appointment : undefined}
            guard={check}
            blocked={blocked}
            visible={visible}
            onHeldChange={setHeld}
            onSettled={refresh}
          />
        )}
      </Page>
    </PageTitle.Provider>
  );
}
