import { useRecordCompany } from '@pages/company/ledger/shared/useRecordCompany';
import { PreparationNotice, PreparationShell } from '@pages/company/ledger/shared/PreparationShell';
import { useRegisterPreparationOwner } from '@pages/company/ledger/shared/useRegisterPreparationOwner';
import { useParticularsRegisters } from './useParticularsRegisters';
import { useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';

import {
  HOLDER_TYPE_LABELS,
  REGISTER_PARTICULARS_COPY,
  appointmentForRegisterStep,
  type CompanyShareTokenListItem,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
} from '@ledova/shared';
import { Row, Rows, Section, LoadError, Loading } from '@components/Ledger';
import { Page } from '@components/Page';
import { useRegisterClasses } from '@hooks/useRegisterClasses';
import { ownerGuard } from '@pages/company/shared/ownerGuard';
import { useOwnAppointments } from '@hooks/useOwnAppointments';
import { shareholderPath } from '@pages/company/ledger/shared/shareholders';
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
  return <PreparationShell lede={LEDE} />;
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
  const { registers, people } = useParticularsRegisters(owner, preparing, guard);
  const found = preparing.flatMap<{
    company: Preparing;
    name: string | null;
    label: string;
    read: { isError: boolean; refetch: () => unknown };
    particulars: (typeof people)[number];
  }>((company, index) => {
    const holder = registers[index].data?.flatMap((register) => register.holders).find((row) => row.member === member);
    if (holder)
      return [
        {
          company,
          name: holder.name,
          label: holder.name || HOLDER_TYPE_LABELS[holder.holderType],
          read: registers[index],
          particulars: people[index],
        },
      ];
    const recipient = people[index].data?.members.find((row) => row.member === member && row.onRegister === false);
    return recipient
      ? [
          {
            company,
            name: recipient.name,
            label: recipient.name || COPY.UNNAMED_MEMBER,
            read: people[index],
            particulars: people[index],
          },
        ]
      : [];
  })[0];
  const companyMatches = useRecordCompany(found?.company.uuid, guard);
  const [formOpen, setFormOpen] = useState(false);
  if (
    !formOpen &&
    found?.particulars.isSuccess &&
    found.particulars.isFetchedAfterMount &&
    found.particulars.fetchStatus === 'idle'
  )
    setFormOpen(true);
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
    content =
      classes.isError || appointments.isError ? (
        <LoadError retry={retry} busy={fetching}>
          {classes.isError ? 'The register could not be loaded.' : 'Your appointments could not be loaded.'}
        </LoadError>
      ) : (
        <Loading>Loading the register…</Loading>
      );
  else if (!companyMatches) content = <PreparationNotice />;
  else if (preparing.length === 0)
    content = <PreparationNotice className="py-3 text-sm text-text-muted">{COPY.READ_ONLY_NOTE}</PreparationNotice>;
  else if (!found)
    content = reads.some((read) => read.isPending) ? (
      <Loading>Loading the register…</Loading>
    ) : stale ? (
      <LoadError retry={retry} busy={fetching}>
        The register or your appointments could not be loaded.
      </LoadError>
    ) : (
      <p className="py-3 text-sm text-text-muted">This member is not a current member of a register you can change.</p>
    );
  else if (found.particulars.isPending) content = <Loading>Loading the register…</Loading>;
  else {
    const recorded = found.particulars.data?.members.find((row) => row.member === member);
    content = (
      <>
        <Section title="Current particulars">
          {found.particulars.isError ? (
            <LoadError retry={() => found.particulars.refetch()} busy={found.particulars.isFetching}>
              Their recorded particulars could not be loaded.
            </LoadError>
          ) : (
            <Rows>
              <Row label="Name">{recorded?.name || found.name || 'Not recorded'}</Row>
              <Row label="Residential address">
                <span className="whitespace-pre-line break-words">
                  {recorded?.residentialAddress || 'Not recorded'}
                </span>
              </Row>
            </Rows>
          )}
          <p className="text-sm text-text-muted">{COPY.PRECEDENCE_NOTE}</p>
        </Section>
        {formOpen ? (
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
              current={{ name: recorded?.name || found.name || '', address: recorded?.residentialAddress ?? '' }}
              blocked={stale}
              onConflict={() => {
                void found.read.refetch();
                void appointments.refetch();
              }}
              onMissing={() => void appointments.refetch()}
            />
          </Section>
        ) : (
          !found.particulars.isError && <Loading>Loading their particulars…</Loading>
        )}
      </>
    );
  }
  return (
    <Page
      narrow
      lede={LEDE}
      back={
        found && companyMatches
          ? {
              to: shareholderPath(member, found.company.uuid),
              label: `Back to ${found.label}`,
            }
          : undefined
      }
    >
      {content}
    </Page>
  );
}
