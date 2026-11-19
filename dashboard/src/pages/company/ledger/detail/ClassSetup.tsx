import { useRecordCompany } from '@pages/company/ledger/shared/useRecordCompany';
import { PreparationNotice } from '@pages/company/ledger/shared/PreparationShell';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  REGISTER_IMPORT_COPY,
  createUserFriendlyError,
  type CompanyShareTokenListItem,
  type OrderSubmissionOwner,
  type RegisterImport,
  type TokenHoldersResponse,
  type RegisterTransferMembers,
  registerClassesKey,
  useOwnAppointments,
  ownAppointmentsKey,
  useRegisterClasses,
  peopleKey,
  usePeople,
  registerSteps,
  type RegisterSteps,
  importsKey,
  useRegisterImports,
  canOpenEmptyRegister,
  importRegisterKey,
  useImportRegister,
} from '@ledova/shared';

import { ImportForm } from './ImportForm';
import { LoadError, Loading, Section } from '@components/Ledger';
import { registerPlace } from '@pages/company/ledger/shared/registerPlace';

type Retained = {
  listed: CompanyShareTokenListItem;
  register: TokenHoldersResponse;
  steps: RegisterSteps;
  correction?: RegisterImport;
  saved?: RegisterImport;
  members: RegisterTransferMembers;
};

export function ClassSetup({
  uuid,
  owner,
  guard,
  available,
  externalHeld = false,
  classHeld,
  onHeldChange,
  classDetails,
  classActions,
  classContent,
  rightsActions,
  classReview,
  classContentHeld = false,
  onRecordsChanged,
  onCannotOpen,
}: {
  uuid: string;
  owner: OrderSubmissionOwner;
  guard: () => void;
  available: boolean;
  externalHeld?: boolean;
  classHeld: boolean;
  onHeldChange?: (held: boolean) => void;
  classDetails: (recordFields: ReactNode) => ReactNode;
  classActions: ReactNode;
  classContent: ReactNode;
  rightsActions: ReactNode;
  classReview: ReactNode;
  classContentHeld?: boolean;
  onRecordsChanged?: () => void;
  onCannotOpen?: () => void;
}) {
  const client = useQueryClient();
  const [search] = useSearchParams();
  const [held, setHeld] = useState(false);
  const keeping = held || classHeld || classContentHeld;
  const [retained, setRetained] = useState<Retained | null>(null);
  useEffect(() => {
    onHeldChange?.(held);
    return () => onHeldChange?.(false);
  }, [held, onHeldChange]);
  const classes = useRegisterClasses(owner, guard);
  const appointments = useOwnAppointments(owner, guard);
  const listed = classes.data?.find((item) => item.uuid === uuid);
  const companyMatches = useRecordCompany(listed?.companyUuid, guard);
  const steps =
    companyMatches && listed && appointments.data ? registerSteps(appointments.data, listed.companyUuid) : null;
  const readable = available && !!(steps?.prepare || steps?.approve || steps?.apply);
  const imports = useRegisterImports(owner, uuid, guard, readable);
  const previousImports = useRef(imports.data);
  useEffect(() => {
    if (previousImports.current && imports.data && previousImports.current !== imports.data) onRecordsChanged?.();
    previousImports.current = imports.data;
  }, [imports.data, onRecordsChanged]);
  const members = usePeople(owner, uuid, guard, readable);
  const register = useImportRegister(owner, uuid, readable, guard);
  const correction = imports.data?.find((proposal) => proposal.status === 'applied' && proposal.correctionAllowed);
  const record = search.get('record');
  const resumed = record ?? (retained ? (retained.saved?.uuid ?? null) : undefined);
  const saved = imports.data?.find((proposal) =>
    resumed !== undefined
      ? proposal.uuid === resumed
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
  const cannotOpen = !keeping && fresh && !record && !!mirrorAllowed && !!correctable && !canOpen;
  useEffect(() => {
    if (cannotOpen) onCannotOpen?.();
  }, [cannotOpen, onCannotOpen]);
  const showForm =
    available &&
    companyMatches &&
    !!retained &&
    !stale &&
    !!listed &&
    readable &&
    (!record || !!saved) &&
    (keeping || (fresh && canOpen));
  if (
    !keeping &&
    fresh &&
    canOpen &&
    (!record || !!saved) &&
    (retained?.listed !== listed ||
      retained?.register !== register.data ||
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
    if (externalHeld || classHeld || classContentHeld)
      throw createUserFriendlyError('Finish the current class action before continuing.');
    for (const key of [
      registerClassesKey(owner),
      ownAppointmentsKey(owner),
      importRegisterKey(owner, uuid),
      importsKey(owner, uuid),
      peopleKey(owner, uuid),
    ]) {
      const state = client.getQueryState(key);
      if (state?.status !== 'success' || state.fetchStatus !== 'idle')
        throw createUserFriendlyError('Refresh current company authority before continuing.');
    }
    if (!fresh || !canOpen || (record && !saved) || retained?.listed.companyUuid !== listed?.companyUuid)
      throw createUserFriendlyError('Your company, authority or source records changed. Refresh before continuing.');
  };
  let content: ReactNode;
  if (!companyMatches) content = <PreparationNotice />;
  else if (fresh && record && !saved)
    content = <p className="text-sm text-text-muted">This saved snapshot is not in the selected share class.</p>;
  else if (!retained || stale || !listed || !readable || (!keeping && (!fresh || !canOpen))) {
    if (stale)
      content = (
        <LoadError retry={retry} busy={fetching}>
          The register or your appointments could not be loaded.
        </LoadError>
      );
    else if (
      !classes.data ||
      !appointments.data ||
      fetching ||
      (readable && (!imports.data || !register.data || !members.data))
    )
      content = <Loading>Loading the register…</Loading>;
    else if (!listed) content = <PreparationNotice />;
    else if (!readable) content = <PreparationNotice>{REGISTER_IMPORT_COPY.READ_ONLY_NOTE}</PreparationNotice>;
    else if (record && imports.data && !saved)
      content = <p className="text-sm text-text-muted">This saved snapshot is not in the selected share class.</p>;
    else if (!mirrorAllowed)
      content = (
        <Section title={`${listed.name} · ${listed.symbol}`}>
          <p className="text-sm text-text-muted">This class uses the chain, and the web app can’t open its register.</p>
        </Section>
      );
    else if (!correctable) {
      const corrections = registerPlace({ company: listed.companyUuid, token: listed.uuid, task: 'corrections' });
      content = (
        <Section title={`${listed.name} · ${listed.symbol}`}>
          <p className="text-sm text-text-muted">
            This opening cannot be replaced safely because later entries or linked member records depend on it. Correct
            individual entries in{' '}
            <Link to={corrections.to} state={corrections.state} className="text-brand-light underline">
              Corrections
            </Link>
            .
          </p>
        </Section>
      );
    } else if (!canOpen) content = <PreparationNotice>{REGISTER_IMPORT_COPY.READ_ONLY_NOTE}</PreparationNotice>;
    else content = <Loading>Loading the register…</Loading>;
  }
  return (
    <>
      {content}
      <div hidden={!showForm}>
        {retained && (
          <ImportForm
            key={`${uuid}/${retained.correction?.uuid ?? 'new'}/${retained.saved?.uuid ?? 'draft'}`}
            owner={owner}
            guard={guard}
            newEffectGuard={checkNew}
            company={retained.listed.companyUuid}
            shareClass={{
              name: listed?.name ?? retained.listed.name,
              symbol: listed?.symbol ?? retained.listed.symbol,
              type: listed?.tokenTypeDisplay ?? retained.listed.tokenTypeDisplay,
            }}
            register={retained.register}
            companyMembers={(members.data ?? retained.members).members}
            emptyOpeningAllowed={
              !!listed &&
              !!register.data &&
              !correction &&
              !imports.data?.some((proposal) => proposal.status === 'applied') &&
              canOpenEmptyRegister(register.data, listed)
            }
            classDetails={classDetails}
            classActions={classActions}
            classContent={classContent}
            rightsActions={rightsActions}
            classReview={classReview}
            classContentHeld={classContentHeld}
            classHeld={classHeld}
            appointment={canPrepare ? steps?.prepare : undefined}
            steps={steps ?? retained.steps}
            correction={retained.correction}
            saved={retained.saved}
            blocked={!fresh || !canOpen || externalHeld || classHeld}
            visible={showForm}
            onConflict={retry}
            onHeldChange={setHeld}
          />
        )}
      </div>
    </>
  );
}
