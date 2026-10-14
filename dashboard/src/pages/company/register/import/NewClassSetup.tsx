import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  DESTINATIONS,
  REGISTER_IMPORT_COPY,
  createCompanyToken,
  createUserFriendlyError,
  failureStatus,
  getCompanyTokens,
  getCompanyToken,
  readEveryPage,
  type CompanyShareToken,
  type Company,
  type OrderSubmissionOwner,
  type TokenCreate,
  type TokenType,
  type RegisterTransferMember,
} from '@ledova/shared';
import { FIELD_CLASS } from '@components/fieldClass';
import { Section } from '@components/Ledger';
import apiClient from '@services/apiClient';
import { CompanySelection } from '../../CompanySelection';
import { useCompany } from '../../hooks/useCompany';
import { Loading, Unavailable } from '../RegisterStatus';
import { registerSteps } from '../proposals';
import { readRegister, useRegisterClasses } from '../useCompanyRegister';
import { ownerGuard, useOwnAppointments } from '../useRegisterImports';
import { readTransferMembers, useTransferMembers } from '../useRegisterTransfers';
import { ImportForm } from './ImportForm';

const TECHNICAL_SHARE_LIMIT = (2n ** 256n - 1n).toString();
const LABEL = 'block space-y-1 text-sm text-text-primary';
const NO_MEMBERS: RegisterTransferMember[] = [];
const COMMON_CLASSES: { type: TokenType; name: string; symbol: string; label: string }[] = [
  { type: 'ordinary', name: 'Ordinary shares', symbol: 'ORD', label: 'Ordinary (ORD)' },
  { type: 'preference', name: 'Preference shares', symbol: 'PRF', label: 'Preference (PRF)' },
  { type: 'redeemable', name: 'Redeemable shares', symbol: 'RED', label: 'Redeemable (RED)' },
];

export function NewClassSetup({
  owner,
  currentOwner,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
}) {
  const read = useCompany({ personalOnly: true });
  const [search] = useSearchParams();
  const preferred = search.get('company');
  const [held, setHeld] = useState(false);
  const [retained, setRetained] = useState<{ company: Company; steps: ReturnType<typeof registerSteps> } | null>(null);
  const appliedPreference = useRef('');
  useEffect(() => {
    if (!preferred || appliedPreference.current === preferred || read.isLoading || read.isRefreshing) return;
    if (read.companies.some((company) => company.uuid === preferred)) read.selectCompany(preferred);
    appliedPreference.current = preferred;
  }, [preferred, read]);
  const guard = useMemo(() => ownerGuard(owner, currentOwner), [owner, currentOwner]);
  const appointments = useOwnAppointments(owner, guard);
  const classes = useRegisterClasses(owner);
  const retry = () => {
    void read.refetch();
    void appointments.refetch();
    void classes.refetch();
    if (anchor) void members.refetch();
  };
  const company = read.company;
  const steps = company && appointments.data ? registerSteps(appointments.data, company.uuid) : null;
  const anchor = classes.data?.find((token) => token.companyUuid === company?.uuid)?.uuid;
  const members = useTransferMembers(owner, anchor ?? '', guard, !!anchor && !!steps?.prepare);
  const ready =
    !read.error &&
    !read.isRefreshing &&
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
      retained.company.updatedAt !== company.updatedAt ||
      retained.steps.prepare?.uuid !== steps.prepare?.uuid)
  )
    setRetained({ company, steps });
  const context = held ? retained : company && steps ? { company, steps } : null;
  if ((!held || !context) && (read.error || classes.isError || appointments.isError || members.isError))
    return (
      <Unavailable
        retry={retry}
        busy={read.isRefreshing || classes.isFetching || appointments.isFetching || members.isFetching}
      />
    );
  if (!context && (read.isLoading || !classes.data || !appointments.data)) return <Loading />;
  return (
    <div className="space-y-5">
      <CompanySelection read={{ ...read, selectionBlocked: read.selectionBlocked || held }} />
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
          read={read}
          classes={(classes.data ?? []).filter((token) => token.companyUuid === context.company.uuid)}
          companyMembers={anchor ? (members.data ?? NO_MEMBERS) : NO_MEMBERS}
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
  read,
  company,
  classes,
  companyMembers,
  steps,
  ready,
  onHeldChange,
  onConflict,
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  read: ReturnType<typeof useCompany>;
  company: Company;
  classes: { uuid: string; name: string; symbol: string; status: string }[];
  companyMembers: RegisterTransferMember[];
  steps: ReturnType<typeof registerSteps>;
  ready: boolean;
  onHeldChange: (held: boolean) => void;
  onConflict: () => void;
}) {
  const navigate = useNavigate();
  const draftClasses = classes.filter((token) => token.status === 'draft');
  const [choice, setChoice] = useState('ordinary');
  const [name, setName] = useState('Ordinary shares');
  const [symbol, setSymbol] = useState('ORD');
  const [tokenType, setTokenType] = useState<TokenType>('ordinary');
  const [classLocked, setClassLocked] = useState(false);
  const creation = useRef<{ request: TokenCreate; dispatched: boolean; token?: CompanyShareToken } | null>(null);
  const check = () => {
    guard();
    read.assertCurrent(company.uuid, 'owner');
    if (!ready) throw createUserFriendlyError('Refresh current company authority and records before continuing.');
  };
  const resolveRegister = async () => {
    check();
    if (!creation.current) {
      setClassLocked(true);
      creation.current = {
        request: {
          company: company.uuid,
          name: name.trim(),
          symbol: symbol.trim(),
          tokenType,
          totalSupply: TECHNICAL_SHARE_LIMIT,
        },
        dispatched: false,
      };
    }
    const operation = creation.current;
    try {
      if (!operation.token) {
        const tokens = await readEveryPage((page) => {
          check();
          return getCompanyTokens(apiClient, { company_uuid: company.uuid, page });
        });
        check();
        const existing = tokens.find((token) => token.symbol === operation.request.symbol);
        if (existing) {
          if (
            !operation.dispatched ||
            existing.companyUuid !== company.uuid ||
            existing.name !== operation.request.name ||
            existing.tokenType !== operation.request.tokenType ||
            existing.totalSupply !== operation.request.totalSupply
          )
            throw createUserFriendlyError(
              'This class code already exists. Choose that share class or use its actual distinct code.',
            );
          const { data } = await getCompanyToken(apiClient, existing.uuid, {
            ledovaSubmissionGuard: check,
          });
          check();
          operation.token = data;
        } else {
          if (operation.dispatched)
            throw createUserFriendlyError(
              'The original class creation result is still uncertain. Refresh and recover it once the class is available; no second creation request will be sent.',
            );
          operation.dispatched = true;
          const { data } = await createCompanyToken(apiClient, operation.request, { ledovaSubmissionGuard: check });
          check();
          operation.token = data;
        }
      }
      const token = operation.token;
      if (
        token.company !== company.uuid ||
        token.name !== operation.request.name ||
        token.symbol !== operation.request.symbol ||
        token.tokenType !== operation.request.tokenType ||
        token.totalSupply !== operation.request.totalSupply ||
        token.contractAddress ||
        token.status !== 'draft'
      )
        throw createUserFriendlyError('The share class receipt did not match the requested company and details.');
      const register = await readRegister(token.uuid);
      check();
      const members = await readTransferMembers(token.uuid, check);
      check();
      return { register, members };
    } catch (failure) {
      if (!operation.token && (failureStatus(failure) === 400 || failureStatus(failure) === 409)) {
        creation.current = null;
        setClassLocked(false);
      }
      throw failure;
    }
  };
  const problems = !read.ownerBusiness
    ? ['The company owner creates new share classes. Select an existing class instead.']
    : [];
  if (!name.trim() || name.length > 100) problems.push('Enter a class name of at most 100 characters.');
  if (!/^[A-Z]{1,5}$/.test(symbol)) problems.push('Enter the recorded class code of 1–5 letters, such as A or ORD.');
  const existingCode = classes.find((token) => token.symbol === symbol);
  if (existingCode && !classLocked)
    problems.push(
      existingCode.status === 'draft'
        ? 'This class code already exists. Select the existing draft share class.'
        : 'This class code already exists. Open its register or use the actual distinct code for a new class.',
    );
  return (
    <Section title={`${company.name} · ${name} (${symbol})`}>
      <ImportForm
        owner={owner}
        guard={guard}
        newEffectGuard={check}
        company={company.uuid}
        companyMembers={companyMembers}
        appointment={steps.prepare!}
        steps={steps}
        blocked={!ready}
        visible={ready}
        onConflict={onConflict}
        onHeldChange={onHeldChange}
        resolveRegister={resolveRegister}
        classProblems={problems}
        classFields={
          <fieldset className="space-y-3">
            <label className={LABEL}>
              Share class
              <select
                className={FIELD_CLASS}
                value={choice}
                disabled={classLocked}
                onChange={(event) => {
                  const selected = event.target.value;
                  if (draftClasses.some((token) => token.uuid === selected)) {
                    navigate(DESTINATIONS.companyRegisterImport.path.replace(':uuid', selected));
                    return;
                  }
                  const common = COMMON_CLASSES.find((item) => item.type === selected);
                  if (common) {
                    setChoice(common.type);
                    setName(common.name);
                    setSymbol(common.symbol);
                    setTokenType(common.type);
                  } else if (selected === 'custom') {
                    setChoice('custom');
                    setName('');
                    setSymbol('');
                    setTokenType('ordinary');
                  }
                }}
              >
                {draftClasses.length > 0 && (
                  <optgroup label="Existing company classes">
                    {draftClasses.map((token) => (
                      <option key={token.uuid} value={token.uuid}>
                        {token.name} · {token.symbol}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="New class">
                  {COMMON_CLASSES.map((item) => (
                    <option key={item.type} value={item.type}>
                      {item.label}
                    </option>
                  ))}
                  <option value="custom">Another class</option>
                </optgroup>
              </select>
            </label>
            {classes.some((token) => token.status !== 'draft') && (
              <p className="text-sm text-text-muted">
                For existing chain classes,{' '}
                <Link
                  to={DESTINATIONS.companyRegister.path}
                  state={{ registerCompany: company.uuid }}
                  className="text-brand-light underline"
                >
                  open Register
                </Link>{' '}
                to open their register or bring in shareholder particulars.
              </p>
            )}
            {choice === 'custom' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className={LABEL}>
                  Class name
                  <input
                    maxLength={100}
                    disabled={classLocked}
                    className={FIELD_CLASS}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <label className={LABEL}>
                  Class code
                  <input
                    maxLength={5}
                    disabled={classLocked}
                    className={FIELD_CLASS}
                    value={symbol}
                    onChange={(event) => setSymbol(event.target.value.toUpperCase())}
                  />
                </label>
                <label className={LABEL}>
                  Class type
                  <select
                    className={FIELD_CLASS}
                    value={tokenType}
                    disabled={classLocked}
                    onChange={(event) => setTokenType(event.target.value as TokenType)}
                  >
                    <option value="ordinary">Ordinary</option>
                    <option value="preference">Preference</option>
                    <option value="redeemable">Redeemable</option>
                  </select>
                </label>
              </div>
            )}
            <p className="text-xs text-text-muted">
              Choose the class already recorded by the company. Set up one class at a time; repeat for other classes.
              {choice === 'custom' && ' The class code uses 1–5 letters, such as A or ORD.'}
            </p>
          </fieldset>
        }
      />
    </Section>
  );
}
