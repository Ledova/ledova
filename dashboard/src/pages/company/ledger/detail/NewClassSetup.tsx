import { Field, TextInput } from '@components/Field';
import { Choices } from '@components/Choices';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { generatePath, Link, useSearchParams } from 'react-router-dom';
import {
  FIELD_LIMITS,
  appointmentForRegisterStep,
  DESTINATIONS,
  REGISTER_CLASS_TYPES,
  REGISTER_IMPORT_COPY,
  REGISTER_SETUP_CHOICES,
  AUTH_QUERY_KEY,
  USER_PREFERENCES_QUERY_KEY,
  createUserFriendlyError,
  type Company,
  type OwnCompanyAppointment,
  type OrderSubmissionOwner,
  type RegisterTransferMember,
  type RegisterTransferMembers,
  registerClassesKey,
  useOwnAppointments,
  ownAppointmentsKey,
  useRegisterClasses,
  peopleKey,
  usePeople,
  registerSteps,
  useNewShareClass,
  useNewClassRights,
  useStartedClasses,
} from '@ledova/shared';

import { CompanyContextNotice } from '@components/CompanyContextNotice';
import { useCompanyContext } from '@hooks/useCompanyContext';
import { ownerGuard } from '@pages/company/shared/ownerGuard';
import { ImportForm } from './ImportForm';
import { LoadError, Loading } from '@components/Ledger';
import { NewClassRights } from './NewClassRights';
import { RightsSummary } from './ClassRights';

const NO_MEMBERS: RegisterTransferMembers = { members: [], awardRecipients: [] };

type FreshClassProps = {
  owner: OrderSubmissionOwner;
  guard: () => void;
  checkCurrent: () => void;
  company: Pick<Company, 'uuid' | 'name'>;
  classes: { uuid: string; name: string; symbol: string; status: string }[];
  companyMembers: RegisterTransferMember[];
  steps: ReturnType<typeof registerSteps>;
  ready: boolean;
  onHeldChange: (held: boolean) => void;
  onConflict: () => void;
  administrator?: string;
};
export function NewClassSetup({
  owner,
  currentOwner,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
}) {
  const client = useQueryClient();
  const [search] = useSearchParams();
  const companyContext = useCompanyContext();
  const preferred = search.get('company') ?? (companyContext ? (companyContext.companyUuid ?? '') : undefined);
  const [held, setHeld] = useState(false);
  const [retained, setRetained] = useState<{
    company: Pick<Company, 'uuid' | 'name'>;
    steps: ReturnType<typeof registerSteps>;
  } | null>(null);
  const guard = useMemo(() => ownerGuard(owner, currentOwner), [owner, currentOwner]);
  const appointments = useOwnAppointments(owner, guard);
  const classes = useRegisterClasses(owner, guard);
  const companies = [
    ...new Map(
      (appointments.data ?? [])
        .filter((appointment) => !appointment.revokedAt && registerSteps([appointment], appointment.company).prepare)
        .map((appointment) => [appointment.company, { uuid: appointment.company, name: appointment.companyName }]),
    ).values(),
  ];
  const retry = () => {
    void appointments.refetch();
    void classes.refetch();
    if (anchor) void members.refetch();
  };
  const companyUuid = preferred ?? (companies.length === 1 ? companies[0].uuid : '');
  const company = companies.find((item) => item.uuid === companyUuid);
  const steps = company && appointments.data ? registerSteps(appointments.data, company.uuid) : null;
  const anchor = classes.data?.find((token) => token.companyUuid === company?.uuid)?.uuid;
  const members = usePeople(owner, anchor ?? '', guard, !!anchor && !!steps?.prepare);
  const ready =
    classes.isSuccess &&
    !classes.isFetching &&
    appointments.isSuccess &&
    !appointments.isFetching &&
    !!steps?.prepare &&
    (!anchor || (members.isSuccess && !members.isFetching));
  if (
    !held &&
    ready &&
    company &&
    steps &&
    (retained?.company.uuid !== company.uuid ||
      retained.company.name !== company.name ||
      retained.steps.prepare?.uuid !== steps.prepare?.uuid)
  )
    setRetained({ company, steps });
  const context = held ? retained : company && steps ? { company, steps } : null;
  const current = useRef({ companyUuid, steps, ready });
  useLayoutEffect(() => {
    current.current = { companyUuid, steps, ready };
  }, [companyUuid, steps, ready]);
  const checkCurrent = () => {
    guard();
    for (const key of [
      AUTH_QUERY_KEY,
      USER_PREFERENCES_QUERY_KEY,
      ownAppointmentsKey(owner),
      registerClassesKey(owner),
      ...(anchor ? [peopleKey(owner, anchor)] : []),
    ]) {
      const state = client.getQueryState(key);
      if (state?.status !== 'success' || state.fetchStatus !== 'idle')
        throw createUserFriendlyError('Refresh current company authority and records before continuing.');
    }
    const rows = client.getQueryData<OwnCompanyAppointment[]>(ownAppointmentsKey(owner)) ?? [];
    const appointment = registerSteps(
      rows.filter((item) => !item.revokedAt),
      companyUuid,
    ).prepare;
    if (
      !current.current.ready ||
      current.current.companyUuid !== companyUuid ||
      !appointment ||
      appointment.uuid !== steps?.prepare?.uuid ||
      current.current.steps?.prepare?.uuid !== steps?.prepare?.uuid
    )
      throw createUserFriendlyError('Your company or authority changed. Reopen this action.');
  };
  if ((!held || !context) && (classes.isError || appointments.isError || members.isError))
    return (
      <LoadError retry={retry} busy={classes.isFetching || appointments.isFetching || members.isFetching}>
        The register or your appointments could not be loaded.
      </LoadError>
    );
  if (!context && (!classes.data || !appointments.data)) return <Loading>Loading the register…</Loading>;
  return (
    <div className="space-y-5">
      {!context ? (
        <CompanyContextNotice />
      ) : !context.steps.prepare ? (
        <p className="text-sm text-text-muted">{REGISTER_IMPORT_COPY.READ_ONLY_NOTE}</p>
      ) : (
        <FreshClass
          key={`${owner.userUuid}/${owner.ownerAccountUuid}/${context.company.uuid}`}
          owner={owner}
          guard={guard}
          company={context.company}
          checkCurrent={checkCurrent}
          classes={(classes.data ?? []).filter((token) => token.companyUuid === context.company.uuid)}
          companyMembers={(anchor ? (members.data ?? NO_MEMBERS) : NO_MEMBERS).members}
          steps={steps ?? context.steps}
          ready={ready && company?.uuid === context.company.uuid}
          onHeldChange={setHeld}
          onConflict={retry}
          administrator={
            appointmentForRegisterStep(
              (appointments.data ?? []).filter((row) => row.capabilities.includes('admin') && !row.revokedAt),
              context.company.uuid,
              'prepare',
            )?.uuid
          }
        />
      )}
    </div>
  );
}

function FreshClass({
  owner,
  guard,
  checkCurrent,
  company,
  classes,
  companyMembers,
  steps,
  ready,
  onHeldChange,
  onConflict,
  administrator,
}: FreshClassProps) {
  const started = useStartedClasses(
    owner,
    guard,
    company.uuid,
    classes.filter((token) => token.status === 'draft'),
    ready,
  );
  const {
    choice,
    choose,
    name,
    setName,
    symbol,
    setSymbol,
    tokenType,
    setTokenType,
    classLocked,
    check,
    resolveRegister,
    problems,
  } = useNewShareClass({ guard, checkCurrent, company, classes, started, ready });
  const [openingHeld, setOpeningHeld] = useState(false);
  const rights = useNewClassRights({
    owner,
    company: company.uuid,
    check,
    resolveRegister,
    newKey: () => crypto.randomUUID(),
  });
  const rightsHeld = !!rights.editor || rights.pending || rights.busy;
  useEffect(() => {
    onHeldChange(openingHeld || rightsHeld);
    return () => onHeldChange(false);
  }, [openingHeld, rightsHeld, onHeldChange]);

  return (
    <ImportForm
      owner={owner}
      guard={guard}
      newEffectGuard={check}
      company={company.uuid}
      shareClass={{ name, symbol, type: REGISTER_CLASS_TYPES.find(([value]) => value === tokenType)?.[1] }}
      companyMembers={companyMembers}
      appointment={steps.prepare!}
      steps={steps}
      blocked={!ready || rightsHeld}
      visible={ready}
      onConflict={onConflict}
      onHeldChange={setOpeningHeld}
      resolveRegister={resolveRegister}
      emptyOpeningAllowed
      classProblems={problems}
      classContent={
        <NewClassRights
          rights={rights}
          administrator={administrator}
          problems={problems}
          classLocked={classLocked}
          blocked={openingHeld}
        />
      }
      classContentHeld={rightsHeld}
      classReview={
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-text-primary">Class rights</h3>
          {rights.saved ? (
            <RightsSummary revision={rights.saved} />
          ) : (
            <p className="text-sm text-text-muted">No rights recorded.</p>
          )}
        </div>
      }
      classFields={
        <>
          {started.length > 0 && !classLocked && (
            <p className="text-sm text-text-muted md:col-span-2">
              Continue a class you started:{' '}
              {started.map((token, index) => (
                <Fragment key={token.uuid}>
                  {index > 0 && ', '}
                  <Link
                    to={generatePath(DESTINATIONS.companyClass.path, { uuid: token.uuid })}
                    className="text-brand-light underline"
                  >
                    {token.name} · {token.symbol}
                  </Link>
                </Fragment>
              ))}
              .
            </p>
          )}
          <div className="md:col-span-2">
            <Choices
              legend="Start with"
              options={REGISTER_SETUP_CHOICES}
              value={choice}
              disabled={classLocked}
              onChange={choose}
            />
          </div>
          {classes.some((token) => token.status !== 'draft') && (
            <p className="text-sm text-text-muted md:col-span-2">
              For existing chain classes,{' '}
              <Link
                to={`${DESTINATIONS.companyRegister.path}?company=${company.uuid}`}
                state={{ registerCompany: company.uuid }}
                className="text-brand-light underline"
              >
                open Ledger
              </Link>{' '}
              to bring in shareholder particulars.
            </p>
          )}
          <Field label="Class name">
            <TextInput
              maxLength={FIELD_LIMITS.CLASS_NAME}
              disabled={classLocked}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="Class code">
            <TextInput
              maxLength={FIELD_LIMITS.CLASS_CODE}
              disabled={classLocked}
              value={symbol}
              onChange={(event) => setSymbol(event.target.value.toUpperCase())}
            />
          </Field>
          {choice === 'custom' && (
            <Choices
              legend="Class type"
              options={REGISTER_CLASS_TYPES}
              value={tokenType}
              disabled={classLocked}
              onChange={setTokenType}
            />
          )}
        </>
      }
    />
  );
}
