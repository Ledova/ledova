import { useMemo, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  DESTINATIONS,
  REGISTER_IMPORT_COPY,
  appointmentForRegisterImportStep,
  useSubmissionOwner,
  useUserPreferences,
  type OrderSubmissionOwner,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Row, Rows, Section, Status } from '@components/Ledger';
import { Page, PageAction } from '@components/Page';
import { Loading, Unavailable } from '../RegisterStatus';
import { READ_TIMING, readRegister, registerKey, useRegisterClasses } from '../useCompanyRegister';
import { ownerGuard, useOwnAppointments } from '../useRegisterImports';
import { ImportForm } from './ImportForm';

const LEDE =
  "Import a share class's existing register from the company's own records. The evidence and figures are provided " +
  'by the company.';

function holdersSignature(register: TokenHoldersResponse) {
  return JSON.stringify([register.initialized, register.holders.map((holder) => [holder.member, holder.balance])]);
}

export default function CompanyRegisterImportPage() {
  const { uuid = '' } = useParams();
  const navigate = useNavigate();
  const { owner, boundary } = useSubmissionOwner();
  const preferences = useUserPreferences();
  const back = <PageAction label="Back to Register" onClick={() => navigate(DESTINATIONS.companyRegister.path)} />;
  if (owner && !preferences.isError)
    return (
      <OwnImport
        key={`${owner.userUuid}/${owner.ownerAccountUuid}/${uuid}`}
        uuid={uuid}
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

function OwnImport({
  uuid,
  owner,
  currentOwner,
  back,
}: {
  uuid: string;
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  back: ReactNode;
}) {
  const guard = useMemo(() => ownerGuard(owner, currentOwner), [owner, currentOwner]);
  const classes = useRegisterClasses(owner);
  const appointments = useOwnAppointments(owner, guard);
  const listed = classes.data?.find((item) => item.uuid === uuid);
  const appointment =
    listed && appointments.data
      ? appointmentForRegisterImportStep(appointments.data, listed.companyUuid, 'prepare')
      : undefined;
  const register = useQuery({
    queryKey: [...registerKey(owner), 'holders', 'class', uuid],
    enabled: !!appointment,
    queryFn: () => readRegister(uuid),
    ...READ_TIMING,
  });
  const retry = () => {
    if (classes.isError) void classes.refetch();
    if (appointments.isError) void appointments.refetch();
    if (register.isError) void register.refetch();
  };
  const fetching = classes.isFetching || appointments.isFetching || register.isFetching;
  const stale = classes.isError || appointments.isError || register.isError;
  let content: ReactNode;
  if (!classes.data || !appointments.data)
    content = classes.isError || appointments.isError ? <Unavailable retry={retry} busy={fetching} /> : <Loading />;
  else if (!listed)
    content = <p className="py-3 text-sm text-text-muted">This share class is not in a register you can read.</p>;
  else if (!appointment)
    content = <p className="py-3 text-sm text-text-muted">{REGISTER_IMPORT_COPY.READ_ONLY_NOTE}</p>;
  else if (!register.data) content = register.isError ? <Unavailable retry={retry} busy={fetching} /> : <Loading />;
  else
    content = (
      <>
        <Section title={register.data.token.name}>
          <p className="text-sm text-text-muted">
            {listed.companyName} · {register.data.token.symbol}
          </p>
          <Rows>
            <Row label="Register">
              <Status tone={register.data.initialized ? 'done' : 'waiting'}>
                {register.data.initialized ? 'Opened' : 'Not opened'}
              </Status>
            </Row>
            {register.data.initialized && <Row label="Current members">{register.data.totalHolders}</Row>}
          </Rows>
          {!register.data.initialized && (
            <p className="text-sm text-text-muted">{REGISTER_IMPORT_COPY.NOT_ON_CHAIN_NOTE}</p>
          )}
        </Section>
        <Section title={REGISTER_IMPORT_COPY.PREPARE}>
          {stale && <Unavailable retry={retry} busy={fetching} />}
          <ImportForm
            key={holdersSignature(register.data)}
            owner={owner}
            guard={guard}
            company={listed.companyUuid}
            register={register.data}
            appointment={appointment}
            blocked={stale}
            onConflict={() => {
              void register.refetch();
              void appointments.refetch();
            }}
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
