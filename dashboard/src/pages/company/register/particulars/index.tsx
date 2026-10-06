import { useMemo, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import {
  DESTINATIONS,
  REGISTER_PARTICULARS_COPY,
  appointmentForRegisterStep,
  useSubmissionOwner,
  useUserPreferences,
  type CompanyShareTokenListItem,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
} from '@ledova/shared';
import { Section } from '@components/Ledger';
import { Page, PageAction } from '@components/Page';
import { Loading, Unavailable } from '../RegisterStatus';
import { registersQuery, useRegisterClasses } from '../useCompanyRegister';
import { ownerGuard, useOwnAppointments } from '../useRegisterImports';
import { ParticularsForm } from './ParticularsForm';

const COPY = REGISTER_PARTICULARS_COPY;
const LEDE =
  "Prepare a change to a member's name and residential address on the register. The supporting document is " +
  'provided by the company.';

type Preparing = { uuid: string; name: string; classes: string[]; appointment: OwnCompanyAppointment };

function preparingCompanies(classes: CompanyShareTokenListItem[], appointments: OwnCompanyAppointment[]) {
  const companies = new Map<string, Preparing>();
  for (const item of classes) {
    const appointment = appointmentForRegisterStep(appointments, item.companyUuid, 'prepare');
    if (!appointment) continue;
    const company = companies.get(item.companyUuid) ?? {
      uuid: item.companyUuid,
      name: item.companyName,
      classes: [],
      appointment,
    };
    company.classes.push(item.uuid);
    companies.set(item.companyUuid, company);
  }
  return [...companies.values()];
}

export default function CompanyRegisterParticularsPage() {
  const { member = '' } = useParams();
  const navigate = useNavigate();
  const { owner, boundary } = useSubmissionOwner();
  const preferences = useUserPreferences();
  const back = <PageAction label="Back to Register" onClick={() => navigate(DESTINATIONS.companyRegister.path)} />;
  if (owner && !preferences.isError)
    return (
      <OwnParticulars
        key={`${owner.userUuid}/${owner.ownerAccountUuid}/${member}`}
        member={member}
        owner={owner}
        currentOwner={boundary.get}
        back={back}
      />
    );
  return (
    <Page lede={LEDE} actions={back}>
      {preferences.isLoading ? (
        <Loading />
      ) : (
        <Unavailable retry={() => void preferences.refetch()} busy={preferences.isFetching} />
      )}
    </Page>
  );
}

function OwnParticulars({
  member,
  owner,
  currentOwner,
  back,
}: {
  member: string;
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  back: ReactNode;
}) {
  const guard = useMemo(() => ownerGuard(owner, currentOwner), [owner, currentOwner]);
  const classes = useRegisterClasses(owner);
  const appointments = useOwnAppointments(owner, guard);
  const preparing = classes.data && appointments.data ? preparingCompanies(classes.data, appointments.data) : [];
  const registers = useQueries({ queries: preparing.map((company) => registersQuery(owner, company.classes)) });
  const found = preparing.flatMap((company, index) => {
    const holder = registers[index].data?.flatMap((register) => register.holders).find((row) => row.member === member);
    return holder ? [{ company, holder, read: registers[index] }] : [];
  })[0];
  const retry = () => {
    if (classes.isError) void classes.refetch();
    if (appointments.isError) void appointments.refetch();
    for (const read of registers) if (read.isError) void read.refetch();
  };
  const fetching = classes.isFetching || appointments.isFetching || registers.some((read) => read.isFetching);
  const stale = classes.isError || appointments.isError || registers.some((read) => read.isError);
  let content: ReactNode;
  if (!classes.data || !appointments.data)
    content = classes.isError || appointments.isError ? <Unavailable retry={retry} busy={fetching} /> : <Loading />;
  else if (preparing.length === 0) content = <p className="py-3 text-sm text-text-muted">{COPY.READ_ONLY_NOTE}</p>;
  else if (!found)
    content = registers.some((read) => read.isPending) ? (
      <Loading />
    ) : stale ? (
      <Unavailable retry={retry} busy={fetching} />
    ) : (
      <p className="py-3 text-sm text-text-muted">This member is not a current member of a register you can change.</p>
    );
  else
    content = (
      <>
        <Section title={found.holder.name || COPY.UNNAMED_MEMBER}>
          <p className="text-sm text-text-muted">{found.company.name}</p>
          <p className="text-sm text-text-muted">{COPY.PRECEDENCE_NOTE}</p>
        </Section>
        <Section title={COPY.PREPARE}>
          {stale && <Unavailable retry={retry} busy={fetching} />}
          <ParticularsForm
            owner={owner}
            guard={guard}
            company={found.company.uuid}
            member={member}
            appointment={found.company.appointment}
            blocked={stale}
            onConflict={() => {
              void found.read.refetch();
              void appointments.refetch();
            }}
            onMissing={() => void appointments.refetch()}
          />
        </Section>
      </>
    );
  return (
    <Page lede={LEDE} actions={back}>
      {content}
    </Page>
  );
}
