import { Field, TextInput } from '@components/Field';
import { Choices } from '@components/Choices';
import { useNewShareClass, type FreshClassProps } from './useNewShareClass';
import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { generatePath, Link, useSearchParams } from 'react-router-dom';
import {
  FIELD_LIMITS,
  DESTINATIONS,
  REGISTER_IMPORT_COPY,
  AUTH_QUERY_KEY,
  USER_PREFERENCES_QUERY_KEY,
  createUserFriendlyError,
  type Company,
  type OwnCompanyAppointment,
  type OrderSubmissionOwner,
  type TokenType,
  type RegisterTransferMembers,
} from '@ledova/shared';

import { CompanySelection } from '@pages/company/shared/CompanySelection';
import { registerSteps } from '@pages/company/shared/proposals';
import { useRegisterClasses, registerClassesKey } from '@pages/company/shared/useCompanyRegister';
import { ownerGuard } from '@pages/company/shared/ownerGuard';
import { useOwnAppointments, ownAppointmentsKey } from '@hooks/useOwnAppointments';
import { peopleKey, usePeople } from '@pages/company/ledger/shared/usePeople';
import { ImportForm } from './ImportForm';
import { LoadError, Loading } from '@components/Ledger';

const NO_MEMBERS: RegisterTransferMembers = { members: [], awardRecipients: [] };
const COMMON_CLASSES: { type: TokenType; name: string; symbol: string; label: string }[] = [
  { type: 'ordinary', name: 'Ordinary shares', symbol: 'ORD', label: 'Ordinary (ORD)' },
  { type: 'preference', name: 'Preference shares', symbol: 'PRF', label: 'Preference (PRF)' },
  { type: 'redeemable', name: 'Redeemable shares', symbol: 'RED', label: 'Redeemable (RED)' },
];

const NEW_CLASSES = [
  ...COMMON_CLASSES.map((item) => [item.type, item.label] as const),
  ['custom', 'Another class'] as const,
];

const CLASS_TYPES: readonly (readonly [TokenType, string])[] = [
  ['ordinary', 'Ordinary'],
  ['preference', 'Preference'],
  ['redeemable', 'Redeemable'],
];
export function NewClassSetup({
  owner,
  currentOwner,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
}) {
  const client = useQueryClient();
  const [search] = useSearchParams();
  const preferred = search.get('company');
  const [selected, setSelected] = useState('');
  const [held, setHeld] = useState(false);
  const [retained, setRetained] = useState<{
    company: Pick<Company, 'uuid' | 'name'>;
    steps: ReturnType<typeof registerSteps>;
  } | null>(null);
  const [appliedPreference, setAppliedPreference] = useState('');
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
  if (preferred && appliedPreference !== preferred && appointments.isSuccess && !appointments.isFetching) {
    if (companies.some((company) => company.uuid === preferred)) setSelected(preferred);
    setAppliedPreference(preferred);
  }
  const retry = () => {
    void appointments.refetch();
    void classes.refetch();
    if (anchor) void members.refetch();
  };
  const companyUuid = selected || (companies.length === 1 ? companies[0].uuid : '');
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
      <CompanySelection
        read={{
          companyUuid: context?.company.uuid ?? companyUuid,
          companies,
          selectionBlocked: held || classes.isFetching || appointments.isFetching,
          selectCompany: setSelected,
        }}
      />
      {!context ? (
        <p className="text-sm text-text-muted">Select the company whose existing records you want to mirror.</p>
      ) : !context.steps.prepare ? (
        <p className="text-sm text-text-muted">{REGISTER_IMPORT_COPY.READ_ONLY_NOTE}</p>
      ) : (
        <FreshClass
          key={`${owner.userUuid}/${context.company.uuid}`}
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
}: FreshClassProps) {
  const {
    draftClasses,
    choice,
    setChoice,
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
  } = useNewShareClass({ guard, checkCurrent, company, classes, ready });

  return (
    <ImportForm
      owner={owner}
      guard={guard}
      newEffectGuard={check}
      company={company.uuid}
      companyName={company.name}
      shareClass={{ name, symbol }}
      companyMembers={companyMembers}
      appointment={steps.prepare!}
      steps={steps}
      blocked={!ready}
      visible={ready}
      onConflict={onConflict}
      onHeldChange={onHeldChange}
      resolveRegister={resolveRegister}
      emptyOpeningAllowed
      classProblems={problems}
      classFields={
        <fieldset className="space-y-5">
          {draftClasses.length > 0 && !classLocked && (
            <p className="text-sm text-text-muted">
              Continue a class you started:{' '}
              {draftClasses.map((token, index) => (
                <Fragment key={token.uuid}>
                  {index > 0 && ', '}
                  <Link
                    to={generatePath(DESTINATIONS.companyRegisterImport.path, { uuid: token.uuid })}
                    className="text-brand-light underline"
                  >
                    {token.name} · {token.symbol}
                  </Link>
                </Fragment>
              ))}
              .
            </p>
          )}
          <Choices
            legend="Share class"
            options={NEW_CLASSES}
            value={choice}
            disabled={classLocked}
            onChange={(selected) => {
              const common = COMMON_CLASSES.find((item) => item.type === selected);
              setChoice(selected);
              setName(common?.name ?? '');
              setSymbol(common?.symbol ?? '');
              setTokenType(common?.type ?? 'ordinary');
            }}
          />
          {classes.some((token) => token.status !== 'draft') && (
            <p className="text-sm text-text-muted">
              For existing chain classes,{' '}
              <Link
                to={DESTINATIONS.companyRegister.path}
                state={{ registerCompany: company.uuid }}
                className="text-brand-light underline"
              >
                open Ledger
              </Link>{' '}
              to open their register or bring in shareholder particulars.
            </p>
          )}
          {choice === 'custom' && (
            <div className="grid gap-3 sm:grid-cols-2">
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
              <Choices
                legend="Class type"
                options={CLASS_TYPES}
                value={tokenType}
                disabled={classLocked}
                onChange={setTokenType}
              />
            </div>
          )}
          {choice === 'custom' && (
            <p className="text-xs text-text-muted">Use the recorded class code of 1–5 letters, such as A or ORD.</p>
          )}
          <p className="text-xs text-text-muted">
            Class code and type do not define the rights attached to the shares. The technical share limit is an
            internal quantity guard, not authorised capital.
          </p>
        </fieldset>
      }
    />
  );
}
