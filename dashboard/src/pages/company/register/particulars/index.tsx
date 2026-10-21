import { PreparationNotice, PreparationShell } from '@pages/company/register/shared/PreparationShell';
import { useRegisterPreparationOwner } from '@pages/company/register/shared/useRegisterPreparationOwner';
import { useParticularsRegisters } from './useParticularsRegisters';
import { useMemo, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';

import {
  REGISTER_PARTICULARS_COPY,
  appointmentForRegisterStep,
  type CompanyShareTokenListItem,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
} from '@ledova/shared';
import { Section, LoadError, Loading } from '@components/Ledger';
import { Page } from '@components/Page';
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
  if (owner && !preferences.isError)
    return (
      <OwnParticulars
        key={`${owner.userUuid}/${owner.ownerAccountUuid}/${member}`}
        member={member}
        owner={owner}
        currentOwner={boundary.get}
      />
    );
  return <PreparationShell lede={LEDE} preferences={preferences} />;
}

function OwnParticulars({
  member,
  owner,
  currentOwner,
}: {
  member: string;
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
}) {
  const guard = useMemo(() => ownerGuard(owner, currentOwner), [owner, currentOwner]);
  const classes = useRegisterClasses(owner, guard);
  const appointments = useOwnAppointments(owner, guard);
  const preparing = classes.data && appointments.data ? preparingCompanies(classes.data, appointments.data) : [];
  const registers = useParticularsRegisters(owner, preparing, guard);
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
  const stale =
    classes.isError || appointments.isError || (found ? found.read.isError : registers.some((read) => read.isError));
  let content: ReactNode;
  if (!classes.data || !appointments.data)
    content =
      classes.isError || appointments.isError ? (
        <LoadError retry={retry} busy={fetching}>
          {classes.isError ? 'The register could not be loaded.' : 'Your appointments could not be loaded.'}
        </LoadError>
      ) : (
        <Loading>Loading the register…</Loading>
      );
  else if (preparing.length === 0)
    content = <PreparationNotice className="py-3 text-sm text-text-muted">{COPY.READ_ONLY_NOTE}</PreparationNotice>;
  else if (!found)
    content = registers.some((read) => read.isPending) ? (
      <Loading>Loading the register…</Loading>
    ) : stale ? (
      <LoadError retry={retry} busy={fetching}>
        The register or your appointments could not be loaded.
      </LoadError>
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
          {stale && (
            <LoadError retry={retry} busy={fetching}>
              The register or your appointments could not be loaded.
            </LoadError>
          )}
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
    <Page
      narrow
      lede={LEDE}
      back={
        found && {
          to: shareholderPath(member, found.company.uuid),
          label: `Back to ${found.holder.name || COPY.UNNAMED_MEMBER}`,
        }
      }
    >
      {content}
    </Page>
  );
}
