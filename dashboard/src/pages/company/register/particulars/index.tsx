import { PreparationBack, PreparationNotice, PreparationShell } from '@pages/company/register/shared/PreparationShell';
import { useRegisterPreparationOwner } from '@pages/company/register/shared/useRegisterPreparationOwner';
import { useParticularsRegisters } from './useParticularsRegisters';
import { useMemo, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';

import {
  DESTINATIONS,
  REGISTER_PARTICULARS_COPY,
  appointmentForRegisterStep,
  type CompanyShareTokenListItem,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
} from '@ledova/shared';
import { Section } from '@components/Ledger';
import { Page } from '@components/Page';
import { Loading, Unavailable } from '@pages/company/shared/RegisterStatus';
import { useRegisterClasses } from '@pages/company/shared/useCompanyRegister';
import { ownerGuard } from '@pages/company/shared/ownerGuard';
import { useOwnAppointments } from '@hooks/useOwnAppointments';
import { shareholderPath } from '@pages/company/register/shared/shareholders';
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
  const { owner, boundary, preferences } = useRegisterPreparationOwner();
  const back = (
    <PreparationBack label="Back to Shareholders" to={`${DESTINATIONS.companyRegister.path}#shareholders`} />
  );
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
  return <PreparationShell lede={LEDE} actions={back} preferences={preferences} />;
}

function OwnParticulars({
  member,
  owner,
  currentOwner,
  back: list,
}: {
  member: string;
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  back: ReactNode;
}) {
  const guard = useMemo(() => ownerGuard(owner, currentOwner), [owner, currentOwner]);
  const classes = useRegisterClasses(owner, guard);
  const appointments = useOwnAppointments(owner, guard);
  const preparing = classes.data && appointments.data ? preparingCompanies(classes.data, appointments.data) : [];
  const { registers, people } = useParticularsRegisters(owner, preparing, guard);
  const found = preparing.flatMap<{
    company: Preparing;
    name: string | null;
    read: { isError: boolean; refetch: () => unknown };
  }>((company, index) => {
    const holder = registers[index].data?.flatMap((register) => register.holders).find((row) => row.member === member);
    if (holder) return [{ company, name: holder.name, read: registers[index] }];
    const recipient = people[index].data?.members.find((row) => row.member === member && row.onRegister === false);
    return recipient ? [{ company, name: recipient.name, read: people[index] }] : [];
  })[0];
  const reads = [...registers, ...people];
  const retry = () => {
    if (classes.isError) void classes.refetch();
    if (appointments.isError) void appointments.refetch();
    for (const read of reads) if (read.isError) void read.refetch();
  };
  const fetching = classes.isFetching || appointments.isFetching || reads.some((read) => read.isFetching);
  const stale =
    classes.isError || appointments.isError || (found ? found.read.isError : reads.some((read) => read.isError));
  let content: ReactNode;
  if (!classes.data || !appointments.data)
    content = classes.isError || appointments.isError ? <Unavailable retry={retry} busy={fetching} /> : <Loading />;
  else if (preparing.length === 0)
    content = <PreparationNotice className="py-3 text-sm text-text-muted">{COPY.READ_ONLY_NOTE}</PreparationNotice>;
  else if (!found)
    content = reads.some((read) => read.isPending) ? (
      <Loading />
    ) : stale ? (
      <Unavailable retry={retry} busy={fetching} />
    ) : (
      <p className="py-3 text-sm text-text-muted">This member is not a current member of a register you can change.</p>
    );
  else
    content = (
      <>
        <Section title={found.name || COPY.UNNAMED_MEMBER}>
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
  const back = found ? (
    <PreparationBack label="Back to shareholder" to={shareholderPath(member, found.company.uuid)} />
  ) : (
    list
  );
  return (
    <Page narrow lede={LEDE} actions={back}>
      {content}
    </Page>
  );
}
