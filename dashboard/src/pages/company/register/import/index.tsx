import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
} from '@ledova/shared';
import { Section } from '@components/Ledger';
import { Page, PageAction } from '@components/Page';
import { PageTitle } from '@components/PageTitle';
import { Loading, Unavailable } from '../RegisterStatus';
import { registerSteps, type RegisterSteps } from '../proposals';
import { READ_TIMING, readRegister, registerKey, useRegisterClasses } from '../useCompanyRegister';
import { importsKey, ownerGuard, useOwnAppointments, useRegisterImports } from '../useRegisterImports';
import { ownAppointmentsKey } from '../../team/appointments';
import { ImportForm } from './ImportForm';
import { NewClassSetup } from './NewClassSetup';

export default function CompanyRegisterImportPage() {
  const { uuid = '' } = useParams();
  const navigate = useNavigate();
  const { owner, boundary } = useSubmissionOwner();
  const preferences = useUserPreferences();
  return (
    <PageTitle.Provider value="Set up your share register">
      <Page
        lede={REGISTER_IMPORT_COPY.MIRROR_NOTE}
        actions={<PageAction label="Back to dashboard" onClick={() => navigate('/company/dashboard')} />}
      >
        <div className="max-w-4xl">
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
        </div>
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
  const fetching = classes.isFetching || appointments.isFetching || register.isFetching || imports.isFetching;
  const stale = classes.isError || appointments.isError || register.isError || imports.isError;
  const fresh = !fetching && !stale && !!listed && readable && !!register.data && !!imports.data;
  const correctable =
    !register.data?.initialized || !imports.data?.some((proposal) => proposal.status === 'applied') || !!correction;
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
      retained?.steps.prepare?.uuid !== steps?.prepare?.uuid ||
      retained?.steps.approve?.uuid !== steps?.approve?.uuid ||
      retained?.steps.apply?.uuid !== steps?.apply?.uuid ||
      retained?.steps.reject?.uuid !== steps?.reject?.uuid)
  )
    setRetained({ listed: listed!, register: register.data!, steps: steps!, correction, saved });
  const retry = () => {
    void classes.refetch();
    void appointments.refetch();
    void register.refetch();
    void imports.refetch();
  };
  const checkNew = () => {
    guard();
    for (const key of [
      [...registerKey(owner), 'classes'],
      ownAppointmentsKey(owner),
      [...registerKey(owner), 'holders', 'class', uuid],
      importsKey(owner, uuid),
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
    if (!classes.data || !appointments.data || fetching || (readable && (!imports.data || !register.data)))
      return <Loading />;
    if (!listed) return <p className="text-sm text-text-muted">This share class is not in a register you can read.</p>;
    if (!readable) return <p className="text-sm text-text-muted">{REGISTER_IMPORT_COPY.READ_ONLY_NOTE}</p>;
    if (record && imports.data && !saved)
      return <p className="text-sm text-text-muted">This saved snapshot is not in the selected share class.</p>;
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
    <Section title={`${retained.listed.companyName} · ${retained.listed.name} (${retained.listed.symbol})`}>
      <ImportForm
        key={`${uuid}/${retained.correction?.uuid ?? 'new'}/${retained.saved?.uuid ?? 'draft'}`}
        owner={owner}
        guard={guard}
        newEffectGuard={checkNew}
        company={retained.listed.companyUuid}
        register={retained.register}
        appointment={canPrepare ? steps?.prepare : undefined}
        steps={steps ?? retained.steps}
        correction={retained.correction}
        saved={retained.saved}
        blocked={!fresh}
        visible={fresh}
        onConflict={retry}
        onHeldChange={setHeld}
      />
    </Section>
  );
}
