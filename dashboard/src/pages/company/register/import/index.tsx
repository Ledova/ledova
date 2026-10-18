import { DESTINATIONS } from '@ledova/shared';
import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  REGISTER_IMPORT_COPY,
  createUserFriendlyError,
  useSubmissionOwner,
  useUserPreferences,
  type CompanyShareTokenListItem,
  type OrderSubmissionOwner,
  type RegisterImport,
  type TokenHoldersResponse,
  type RegisterTransferMember,
} from '@ledova/shared';
import { Page } from '@components/Page';
import { PageTitle } from '@components/PageTitle';
import { Loading, Unavailable } from '@pages/company/shared/RegisterStatus';
import { registerSteps, type RegisterSteps } from '@pages/company/shared/proposals';
import { READ_TIMING, registerKey } from '@hooks/useRegisterAccess';
import { readRegister, useRegisterClasses } from '@pages/company/shared/useCompanyRegister';
import { importsKey, useRegisterImports } from '@pages/company/register/shared/useRegisterImports';
import { ownerGuard } from '@pages/company/register/shared/ownerGuard';
import { useOwnAppointments } from '@pages/company/shared/useOwnAppointments';
import { ownAppointmentsKey } from '@pages/company/shared/appointments';
import { transferMembersKey, useTransferMembers } from '@pages/company/register/shared/useRegisterTransfers';
import { ImportForm } from './ImportForm';
import { NewClassSetup } from './NewClassSetup';

export default function CompanyRegisterImportPage() {
  const { uuid = '' } = useParams();
  const { owner, boundary } = useSubmissionOwner();
  const preferences = useUserPreferences();
  return (
    <PageTitle.Provider value="Set up your share register">
      <Page narrow>
        {owner && !preferences.isError ? (
          uuid ? (
            <OwnImport
              key={`${owner.userUuid}/${owner.ownerAccountUuid}/${uuid}`}
              uuid={uuid}
              owner={owner}
              currentOwner={boundary.get}
            />
          ) : (
            <NewClassSetup
              key={`${owner.userUuid}/${owner.ownerAccountUuid}`}
              owner={owner}
              currentOwner={boundary.get}
            />
          )
        ) : preferences.isLoading ? (
          <Loading />
        ) : (
          <Unavailable retry={() => void preferences.refetch()} busy={preferences.isFetching} />
        )}
      </Page>
    </PageTitle.Provider>
  );
}

type Retained = {
  listed: CompanyShareTokenListItem;
  register: TokenHoldersResponse;
  steps: RegisterSteps;
  correction?: RegisterImport;
  saved?: RegisterImport;
  members: RegisterTransferMember[];
};

function OwnImport({
  uuid,
  owner,
  currentOwner,
}: {
  uuid: string;
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
}) {
  const client = useQueryClient();
  const [search] = useSearchParams();
  const [held, setHeld] = useState(false);
  const [retained, setRetained] = useState<Retained | null>(null);
  const guard = useMemo(() => ownerGuard(owner, currentOwner), [owner, currentOwner]);
  const classes = useRegisterClasses(owner);
  const appointments = useOwnAppointments(owner, guard);
  const listed = classes.data?.find((item) => item.uuid === uuid);
  const steps = listed && appointments.data ? registerSteps(appointments.data, listed.companyUuid) : null;
  const readable = !!(steps?.prepare || steps?.approve || steps?.apply);
  const imports = useRegisterImports(owner, uuid, guard, readable);
  const members = useTransferMembers(owner, uuid, guard, readable);
  const register = useQuery({
    queryKey: [...registerKey(owner), 'holders', 'class', uuid],
    enabled: readable,
    queryFn: () => readRegister(uuid),
    ...READ_TIMING,
  });
  const correction = imports.data?.find((proposal) => proposal.status === 'applied' && proposal.correctionAllowed);
  const record = search.get('record');
  const saved = imports.data?.find((proposal) =>
    record
      ? proposal.uuid === record
      : proposal.status === 'submitted' &&
        proposal.sourceConfirmed &&
        proposal.correctionOf === (correction?.uuid ?? null),
  );
  const fetching =
    classes.isFetching || appointments.isFetching || register.isFetching || imports.isFetching || members.isFetching;
  const stale = classes.isError || appointments.isError || register.isError || imports.isError || members.isError;
  const fresh = !fetching && !stale && !!listed && readable && !!register.data && !!imports.data && !!members.data;
  const mirrorAllowed = register.data?.initialized || register.data?.token.status === 'draft';
  const correctable =
    mirrorAllowed &&
    (!register.data?.initialized || !imports.data?.some((proposal) => proposal.status === 'applied') || !!correction);
  const canPrepare = !!steps?.prepare && correctable;
  const canOpen = saved ? saved.status !== 'rejected' || canPrepare : canPrepare;
  if (
    !held &&
    fresh &&
    canOpen &&
    (!record || !!saved) &&
    (retained?.register !== register.data ||
      retained?.correction !== correction ||
      retained?.saved !== saved ||
      retained?.members !== members.data ||
      retained?.steps.prepare?.uuid !== steps?.prepare?.uuid ||
      retained?.steps.approve?.uuid !== steps?.approve?.uuid ||
      retained?.steps.apply?.uuid !== steps?.apply?.uuid ||
      retained?.steps.reject?.uuid !== steps?.reject?.uuid)
  )
    setRetained({
      listed: listed!,
      register: register.data!,
      steps: steps!,
      correction,
      saved,
      members: members.data!,
    });
  const retry = () => {
    void classes.refetch();
    void appointments.refetch();
    void register.refetch();
    void imports.refetch();
    void members.refetch();
  };
  const checkNew = () => {
    guard();
    for (const key of [
      [...registerKey(owner), 'classes'],
      ownAppointmentsKey(owner),
      [...registerKey(owner), 'holders', 'class', uuid],
      importsKey(owner, uuid),
      transferMembersKey(owner, uuid),
    ]) {
      const state = client.getQueryState(key);
      if (state?.status !== 'success' || state.fetchStatus !== 'idle')
        throw createUserFriendlyError('Refresh current company authority before continuing.');
    }
    if (!fresh || !canOpen || retained?.listed.companyUuid !== listed?.companyUuid)
      throw createUserFriendlyError('Your company, authority or source records changed. Refresh before continuing.');
  };
  if (!held && fresh && record && !saved)
    return <p className="text-sm text-text-muted">This saved snapshot is not in the selected share class.</p>;
  if (!retained || (!held && (!fresh || !canOpen))) {
    if (stale) return <Unavailable retry={retry} busy={fetching} />;
    if (
      !classes.data ||
      !appointments.data ||
      fetching ||
      (readable && (!imports.data || !register.data || !members.data))
    )
      return <Loading />;
    if (!listed) return <p className="text-sm text-text-muted">This share class is not in a register you can read.</p>;
    if (!readable) return <p className="text-sm text-text-muted">{REGISTER_IMPORT_COPY.READ_ONLY_NOTE}</p>;
    if (record && imports.data && !saved)
      return <p className="text-sm text-text-muted">This saved snapshot is not in the selected share class.</p>;
    if (!mirrorAllowed)
      return (
        <p className="text-sm text-text-muted">
          This class cannot open from copied records.{' '}
          <Link
            to={DESTINATIONS.companyRegister.path}
            state={{ registerCompany: listed.companyUuid }}
            className="text-brand-light underline"
          >
            Open Register
          </Link>{' '}
          to open it from the chain or check its deployment state.
        </p>
      );
    if (!correctable)
      return (
        <p className="text-sm text-text-muted">
          This opening cannot be replaced safely. Later changes or linked member records need their own supported
          correction.
        </p>
      );
    if (!canOpen) return <p className="text-sm text-text-muted">{REGISTER_IMPORT_COPY.READ_ONLY_NOTE}</p>;
    return <Loading />;
  }
  return (
    <ImportForm
      key={`${uuid}/${retained.correction?.uuid ?? 'new'}/${retained.saved?.uuid ?? 'draft'}`}
      owner={owner}
      guard={guard}
      newEffectGuard={checkNew}
      company={retained.listed.companyUuid}
      companyName={retained.listed.companyName}
      shareClass={{ name: retained.listed.name, symbol: retained.listed.symbol }}
      register={retained.register}
      companyMembers={members.data ?? retained.members}
      classFields={
        <dl className="grid gap-4 sm:grid-cols-2">
          {[
            ['Share class', retained.listed.name],
            ['Class code', retained.listed.symbol],
            ['Class type', retained.listed.tokenTypeDisplay || 'Not recorded'],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-sm text-text-muted">{label}</dt>
              <dd className="mt-1 text-sm font-medium text-text-primary">{value}</dd>
            </div>
          ))}
        </dl>
      }
      appointment={canPrepare ? steps?.prepare : undefined}
      steps={steps ?? retained.steps}
      correction={retained.correction}
      saved={retained.saved}
      blocked={!fresh}
      visible={fresh}
      onConflict={retry}
      onHeldChange={setHeld}
    />
  );
}
