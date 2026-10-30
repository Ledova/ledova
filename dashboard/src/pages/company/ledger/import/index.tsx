import { useRecordCompany } from '@pages/company/ledger/shared/useRecordCompany';
import { PreparationNotice, PreparationPreferences } from '@pages/company/ledger/shared/PreparationShell';
import { useRegisterPreparationOwner } from '@pages/company/ledger/shared/useRegisterPreparationOwner';
import { useImportRegister, importRegisterKey } from './useImportRegister';
import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  REGISTER_COPY,
  REGISTER_IMPORT_COPY,
  TECHNICAL_SHARE_LIMIT,
  createUserFriendlyError,
  formatShareCount,
  type CompanyShareTokenListItem,
  type OrderSubmissionOwner,
  type RegisterImport,
  type TokenHoldersResponse,
  type RegisterTransferMembers,
} from '@ledova/shared';
import { Page } from '@components/Page';
import { registerSteps, type RegisterSteps } from '@pages/company/shared/proposals';
import { useRegisterClasses, registerClassesKey } from '@hooks/useRegisterClasses';
import { importsKey, useRegisterImports } from '@pages/company/ledger/shared/useRegisterImports';
import { ownerGuard } from '@pages/company/shared/ownerGuard';
import { useOwnAppointments, ownAppointmentsKey } from '@hooks/useOwnAppointments';

import { peopleKey, usePeople } from '@pages/company/ledger/shared/usePeople';
import { ImportForm } from './ImportForm';
import { NewClassSetup } from './NewClassSetup';
import { canOpenEmptyRegister } from './preparation';
import { LoadError, Loading, Row, Rows, Section } from '@components/Ledger';
import { registerPlace } from '@pages/company/ledger/shared/registerPlace';

export default function CompanyRegisterImportPage() {
  const { uuid = '' } = useParams();
  const { owner, boundary, preferences } = useRegisterPreparationOwner();
  return (
    <Page>
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
      ) : (
        <PreparationPreferences preferences={preferences} />
      )}
    </Page>
  );
}

type Retained = {
  listed: CompanyShareTokenListItem;
  register: TokenHoldersResponse;
  steps: RegisterSteps;
  correction?: RegisterImport;
  saved?: RegisterImport;
  members: RegisterTransferMembers;
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
  const classes = useRegisterClasses(owner, guard);
  const appointments = useOwnAppointments(owner, guard);
  const listed = classes.data?.find((item) => item.uuid === uuid);
  const companyMatches = useRecordCompany(listed?.companyUuid, guard);
  const steps =
    companyMatches && listed && appointments.data ? registerSteps(appointments.data, listed.companyUuid) : null;
  const readable = !!(steps?.prepare || steps?.approve || steps?.apply);
  const imports = useRegisterImports(owner, uuid, guard, readable);
  const members = usePeople(owner, uuid, guard, readable);
  const register = useImportRegister(owner, uuid, readable, guard);
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
    if (!fresh || !canOpen || retained?.listed.companyUuid !== listed?.companyUuid)
      throw createUserFriendlyError('Your company, authority or source records changed. Refresh before continuing.');
  };
  if (!companyMatches) return <PreparationNotice />;
  if (!held && fresh && record && !saved)
    return <p className="text-sm text-text-muted">This saved snapshot is not in the selected share class.</p>;
  if (!retained || (!held && (!fresh || !canOpen))) {
    if (stale)
      return (
        <LoadError retry={retry} busy={fetching}>
          The register or your appointments could not be loaded.
        </LoadError>
      );
    if (
      !classes.data ||
      !appointments.data ||
      fetching ||
      (readable && (!imports.data || !register.data || !members.data))
    )
      return <Loading>Loading the register…</Loading>;
    if (!listed) return <PreparationNotice />;
    if (!readable) return <PreparationNotice>{REGISTER_IMPORT_COPY.READ_ONLY_NOTE}</PreparationNotice>;
    if (record && imports.data && !saved)
      return <p className="text-sm text-text-muted">This saved snapshot is not in the selected share class.</p>;
    if (!mirrorAllowed)
      return (
        <Section title={`${listed.name} · ${listed.symbol}`}>
          <p className="text-sm text-text-muted">This class is on chain, and the web app can’t open its register.</p>
        </Section>
      );
    if (!correctable) {
      const corrections = registerPlace({ company: listed.companyUuid, token: listed.uuid, task: 'corrections' });
      return (
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
    }
    if (!canOpen) return <PreparationNotice>{REGISTER_IMPORT_COPY.READ_ONLY_NOTE}</PreparationNotice>;
    return <Loading>Loading the register…</Loading>;
  }
  return (
    <ImportForm
      key={`${uuid}/${retained.correction?.uuid ?? 'new'}/${retained.saved?.uuid ?? 'draft'}`}
      owner={owner}
      guard={guard}
      newEffectGuard={checkNew}
      company={retained.listed.companyUuid}
      shareClass={{ name: retained.listed.name, symbol: retained.listed.symbol }}
      register={retained.register}
      companyMembers={(members.data ?? retained.members).members}
      emptyOpeningAllowed={
        !!listed &&
        !!register.data &&
        !correction &&
        !imports.data?.some((proposal) => proposal.status === 'applied') &&
        canOpenEmptyRegister(register.data, listed)
      }
      classFields={
        <Rows>
          {[
            ['Class name', retained.listed.name],
            ['Class code', retained.listed.symbol],
            ['Class type', retained.listed.tokenTypeDisplay || 'Not recorded'],
            [
              'Technical share limit',
              retained.listed.totalSupply === TECHNICAL_SHARE_LIMIT
                ? REGISTER_COPY.QUANTITY_GUARD
                : formatShareCount(retained.listed.totalSupply),
            ],
          ].map(([label, value]) => (
            <Row key={label} label={label}>
              {value}
            </Row>
          ))}
        </Rows>
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
