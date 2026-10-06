import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type { AxiosInstance, AxiosResponse, AxiosRequestTransformer, AxiosRequestConfig } from 'axios';
import { getOwnCompanyAppointments } from '../services/company-authority';
import { getInvestorClassifications } from '../services/investorClassifications';
import {
  createEligibilityRequest,
  decideEligibilityRequest,
  getCompanyEligibilityRequest,
  getCompanyEligibilityRequests,
  getEligibilityRequest,
  getEligibilityRequests,
  previewEligibilityDecision,
  previewEligibilityRequest,
  revokeEligibilityDecision,
  withdrawEligibilityRequest,
} from '../services/company-eligibility';
import type {
  CompanyEligibilityRequest,
  CompanyEligibilityRequestPreview,
  CompanyEligibilityRequestPreviewResult,
  CompanyEligibilityDecisionPreview,
  CompanyEligibilityDecisionPreviewResult,
  CompanyEligibilityRequestCreate,
  CompanyEligibilityDecisionCreate,
  CompanyEligibilityRevocationCreate,
  CompanyEligibilityWithdrawalCreate,
  InvestorClassification,
  OwnCompanyAppointment,
} from '../types';
import { createUserFriendlyError, getErrorMessage } from '../utils/errors';
import { isUuid } from '../utils/validation';
import { readEveryPage } from '../utils/pagination';
import { useSubmissionOwner } from './useSubmissionOwner';
import { USER_PREFERENCES_QUERY_KEY } from './useUserPreferences';
import type { OrderSubmissionSession } from './useOrderSubmissions';

export const ELIGIBILITY_RECORDS_NOTICE =
  'Each company decides eligibility for its own offerings and share classes. New actions recheck the current decision, evidence and exact scope.';
export type EligibilityRequestDraft = {
  source: string;
  company: string;
  offering: string;
  quantity: string;
  requestedExpiresAt: string;
};
export type EligibilityDecisionDraft = { outcome: 'accepted' | 'refused'; expiresAt: string; reason: string };
export type EligibilityAction = {
  kind: 'request' | 'decision' | 'withdrawal' | 'revocation';
  key: string;
  request?: CompanyEligibilityRequestPreviewResult;
  decision?: CompanyEligibilityDecisionPreviewResult;
  record?: CompanyEligibilityRequest;
  appointment?: string;
  reason?: string;
  outcome?: 'accepted' | 'refused';
  expiresAt?: string | null;
  uncertain: boolean;
};
type Payload =
  | CompanyEligibilityRequestCreate
  | CompanyEligibilityDecisionCreate
  | CompanyEligibilityWithdrawalCreate
  | CompanyEligibilityRevocationCreate;
type Command = EligibilityAction & { payload: Payload; binding: string; signature: string; generation: number };
const retainedRetries = new WeakMap<QueryClient, Map<string, Command>>();
function retriesFor(client: QueryClient) {
  let values = retainedRetries.get(client);
  if (!values) {
    values = new Map();
    retainedRetries.set(client, values);
  }
  return values;
}
const requestDraft: EligibilityRequestDraft = {
  source: '',
  company: '',
  offering: '',
  quantity: '',
  requestedExpiresAt: '',
};
const decisionDraft: EligibilityDecisionDraft = { outcome: 'accepted', expiresAt: '', reason: '' };

export function isCurrentEligibilityAppointment(appointment: OwnCompanyAppointment) {
  return (
    appointment.status === 'active' &&
    appointment.isEffective &&
    !appointment.revokedAt &&
    (appointment.expiresAt === null || Date.parse(appointment.expiresAt) > Date.now())
  );
}

async function everyPage<T>(
  read: (page: number) => Promise<AxiosResponse<{ results: T[]; next?: string | null; count: number }>>,
  guard: () => void,
) {
  return readEveryPage(async (page) => {
    guard();
    const response = await read(page);
    guard();
    if (!Array.isArray(response.data?.results) || !Number.isSafeInteger(response.data.count) || response.data.count < 0)
      throw createUserFriendlyError('The records response could not be confirmed. Refresh before continuing.');
    return response;
  });
}

function expiry(value: string) {
  const moment = Date.parse(value);
  if (!value.trim() || !Number.isFinite(moment)) throw createUserFriendlyError('Enter a valid expiry date and time.');
  return new Date(moment).toISOString();
}

function useEligibilityRecords(
  api: AxiosInstance,
  mode: 'participant' | 'company',
  newKey: () => string,
  session?: OrderSubmissionSession,
) {
  const client = useQueryClient();
  const { owner, boundary } = useSubmissionOwner(session);
  const mounted = useRef(true);
  const pending = useRef(false);
  const generation = useRef(0);
  const active = useRef<Command | null>(null);
  const retries = useRef(retriesFor(client));
  const [action, setAction] = useState<Command | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authorityClock, setAuthorityClock] = useState(0);
  const [selection, setSelection] = useState({
    company: '',
    appointment: '',
    record: '',
    request: { ...requestDraft },
    decision: { ...decisionDraft },
  });
  const selected = useRef(selection);
  selected.current = selection;
  const scope = [owner?.userUuid ?? '', owner?.ownerAccountUuid ?? '', session?.getEpoch() ?? 0];
  const sourceKey = ['eligibility-sources', ...scope];
  const appointmentKey = ['company-appointments', ...scope.slice(0, 2)];
  const listKey = ['eligibility-records', mode, ...scope, selection.company];
  const detailKey = [...listKey, selection.record];
  const ownerGuard = () => {
    const state = client.getQueryState(USER_PREFERENCES_QUERY_KEY);
    if (
      !mounted.current ||
      !owner ||
      boundary.get() !== owner ||
      state?.status !== 'success' ||
      state.fetchStatus !== 'idle'
    )
      throw createUserFriendlyError('Your account or session changed. Reopen these records before continuing.');
  };
  const config = (guard = ownerGuard): AxiosRequestConfig => ({
    ...session?.requestConfig(),
    ledovaSubmissionGuard: guard,
  });
  const sources = useQuery({
    queryKey: sourceKey,
    enabled: !!owner && mode === 'participant',
    queryFn: async () => {
      const rows = await everyPage((page) => getInvestorClassifications(api, page, config()), ownerGuard);
      if (rows.some((row) => row.userAccount !== owner!.ownerAccountUuid))
        throw createUserFriendlyError('The source account could not be confirmed.');
      return rows;
    },
  });
  const appointments = useQuery({
    queryKey: appointmentKey,
    enabled: !!owner && mode === 'company',
    queryFn: () => everyPage((page) => getOwnCompanyAppointments(api, page, config()), ownerGuard),
  });
  const companyGuard = () => {
    ownerGuard();
    const state = client.getQueryState(appointmentKey);
    if (state?.status !== 'success' || state.fetchStatus !== 'idle')
      throw createUserFriendlyError('Refresh your personal appointments before continuing.');
    const rows = client.getQueryData<OwnCompanyAppointment[]>(appointmentKey) ?? [];
    if (
      !selected.current.company ||
      !rows.some(
        (row) =>
          row.company === selected.current.company &&
          isCurrentEligibilityAppointment(row) &&
          row.capabilities.some((capability) => capability === 'prepare' || capability === 'approve'),
      )
    )
      throw createUserFriendlyError('Current personal prepare or approve authority is required for this company.');
  };
  const readGuard = () => {
    if (mode === 'company') companyGuard();
    else ownerGuard();
  };
  const list = useQuery({
    queryKey: listKey,
    enabled: !!owner && (mode === 'participant' || !!selection.company),
    queryFn: async () => {
      const companyUuid = selection.company;
      const guard =
        mode === 'participant'
          ? ownerGuard
          : () => {
              companyGuard();
              if (selected.current.company !== companyUuid)
                throw createUserFriendlyError('The selected company changed.');
            };
      const rows = await everyPage(
        (page) =>
          mode === 'participant'
            ? getEligibilityRequests(api, page, config(guard))
            : getCompanyEligibilityRequests(api, companyUuid, page, config(guard)),
        guard,
      );
      if (
        rows.some((row) =>
          mode === 'participant' ? row.userAccount !== owner!.ownerAccountUuid : row.company !== companyUuid,
        )
      )
        throw createUserFriendlyError('The records audience could not be confirmed.');
      return rows;
    },
  });
  const detail = useQuery({
    queryKey: detailKey,
    enabled: !!owner && !!selection.record && (mode === 'participant' || !!selection.company),
    queryFn: async () => {
      const target = { ...selection };
      const guard = () => {
        readGuard();
        if (selected.current.record !== target.record || selected.current.company !== target.company)
          throw createUserFriendlyError('The selected record changed.');
      };
      guard();
      const response = await (mode === 'participant'
        ? getEligibilityRequest(api, target.record, config(guard))
        : getCompanyEligibilityRequest(api, target.company, target.record, config(guard)));
      guard();
      if (
        response.data.uuid !== target.record ||
        (mode === 'participant'
          ? response.data.userAccount !== owner!.ownerAccountUuid
          : response.data.company !== target.company)
      )
        throw createUserFriendlyError('The selected record response could not be confirmed.');
      return response.data;
    },
  });
  const retire = () => {
    generation.current += 1;
    active.current = null;
    setAction(null);
    setError(null);
  };
  const change = (patch: Partial<typeof selection>) => {
    retire();
    selected.current = { ...selected.current, ...patch };
    setSelection(selected.current);
  };
  const binding = (kind: EligibilityAction['kind'], reason = '') =>
    JSON.stringify([
      mode,
      ...scope,
      kind,
      selected.current.company,
      selected.current.appointment,
      selected.current.record,
      kind === 'request' ? selected.current.request : kind === 'decision' ? selected.current.decision : reason,
    ]);
  const signature = () =>
    JSON.stringify([
      selected.current,
      client
        .getQueryData<InvestorClassification[]>(sourceKey)
        ?.find((row) => row.uuid === selected.current.request.source),
      mode === 'company'
        ? client
            .getQueryData<OwnCompanyAppointment[]>(appointmentKey)
            ?.filter((row) => row.company === selected.current.company)
        : null,
      selected.current.record
        ? client.getQueryData<CompanyEligibilityRequest>([
            ...listKey.slice(0, -1),
            selected.current.company,
            selected.current.record,
          ])
        : null,
    ]);
  const commandGuard = (target: Command) => {
    readGuard();
    if (active.current !== target || target.generation !== generation.current || target.signature !== signature())
      throw createUserFriendlyError(
        'The source, company, appointment, record or terms changed. Review again before continuing.',
      );
    const state = client.getQueryState(target.kind === 'request' ? sourceKey : detailKey);
    if (state?.status !== 'success' || state.fetchStatus !== 'idle')
      throw createUserFriendlyError('Refresh the exact evidence source or request before continuing.');
    if (mode === 'company') {
      const queue = client.getQueryState(listKey);
      if (queue?.status !== 'success' || queue.fetchStatus !== 'idle')
        throw createUserFriendlyError('Refresh this company’s request queue before continuing.');
    }
  };
  const effectGuard = (target: Command) => {
    commandGuard(target);
    if (mode === 'company' && !target.uncertain && (target.kind === 'decision' || target.kind === 'revocation')) {
      const appointment = client
        .getQueryData<OwnCompanyAppointment[]>(appointmentKey)
        ?.find((row) => row.uuid === target.appointment && row.company === target.record?.company);
      if (
        !appointment ||
        !isCurrentEligibilityAppointment(appointment) ||
        !appointment.capabilities.includes('approve')
      )
        throw createUserFriendlyError(
          'Your exact current personal approve appointment is required to record this action.',
        );
    }
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      active.current = null;
    };
  }, []);
  useEffect(() => {
    const changed = () => {
      const target = active.current;
      if (!target) return;
      try {
        commandGuard(target);
      } catch {
        generation.current += 1;
        active.current = null;
        if (mounted.current) setAction(null);
      }
    };
    const unsubscribe = client.getQueryCache().subscribe(changed);
    const unsubscribeSession = session?.subscribe(changed);
    changed();
    return () => {
      unsubscribe();
      unsubscribeSession?.();
    };
  });
  useEffect(() => {
    if (mode !== 'company' || !owner) return;
    const next = (appointments.data ?? [])
      .filter(
        (row) =>
          row.status === 'active' &&
          row.isEffective &&
          !row.revokedAt &&
          row.capabilities.some((capability) => capability === 'prepare' || capability === 'approve'),
      )
      .map((row) => Date.parse(row.expiresAt ?? ''))
      .filter((moment) => moment > Date.now())
      .sort((left, right) => left - right)[0];
    if (next === undefined) return;
    const timer = setTimeout(
      () => {
        const target = active.current;
        if (target) {
          try {
            effectGuard(target);
          } catch {
            generation.current += 1;
            active.current = null;
            setAction(null);
          }
        }
        setAuthorityClock((value) => value + 1);
      },
      Math.min(2_147_483_647, Math.max(1, next - Date.now() + 1)),
    );
    return () => clearTimeout(timer);
  }, [appointments.data, authorityClock, mode, owner]);
  const refresh = async () => {
    retire();
    if (client.getQueryState(USER_PREFERENCES_QUERY_KEY)?.status !== 'success') {
      await client.refetchQueries({ queryKey: USER_PREFERENCES_QUERY_KEY });
      return;
    }
    if (!owner || (mode === 'company' && !selection.company)) {
      if (owner) await appointments.refetch();
      return;
    }
    await (mode === 'participant' ? sources.refetch() : appointments.refetch());
    await list.refetch();
    if (selection.record) await detail.refetch();
  };
  const prepare = async (kind: EligibilityAction['kind'], reason = '') => {
    if (pending.current) return;
    retire();
    const ticket = generation.current;
    pending.current = true;
    setBusy(true);
    try {
      readGuard();
      const before = signature();
      const guard = () => {
        readGuard();
        if (ticket !== generation.current || before !== signature())
          throw createUserFriendlyError('Your selection changed while preparing. Review it again.');
      };
      const identity = binding(kind, reason);
      const retry = retries.current.get(identity);
      if (retry) {
        const target = { ...retry, signature: before, generation: ticket };
        active.current = target;
        setAction(target);
        return;
      }
      const value = selected.current;
      const record = value.record ? client.getQueryData<CompanyEligibilityRequest>(detailKey) : undefined;
      const appointment = (client.getQueryData<OwnCompanyAppointment[]>(appointmentKey) ?? []).find(
        (row) => row.uuid === value.appointment && row.company === value.company,
      );
      let payload: Payload;
      let request: CompanyEligibilityRequestPreviewResult | undefined;
      let decision: CompanyEligibilityDecisionPreviewResult | undefined;
      const key = newKey();
      if (!isUuid(key)) throw createUserFriendlyError('A valid request key could not be created.');
      if (kind === 'request') {
        const source = (client.getQueryData<InvestorClassification[]>(sourceKey) ?? []).find(
          (row) => row.uuid === value.request.source,
        );
        if (
          !source ||
          !['submitted', 'verified'].includes(source.status) ||
          source.userAccount !== owner!.ownerAccountUuid
        )
          throw createUserFriendlyError('Select your own submitted evidence or retained historical evidence source.');
        const input: CompanyEligibilityRequestPreview = {
          source: source.uuid,
          requestedExpiresAt: expiry(value.request.requestedExpiresAt),
        };
        if (source.category === 'product_value') {
          if (
            !isUuid(value.request.offering) ||
            !/^[1-9]\d*$/.test(value.request.quantity) ||
            !Number.isSafeInteger(Number(value.request.quantity))
          )
            throw createUserFriendlyError('Enter an approved offering UUID and a positive whole-share quantity.');
          input.offering = value.request.offering;
          input.quantity = Number(value.request.quantity);
        } else {
          if (!isUuid(value.request.company))
            throw createUserFriendlyError('Enter the exact company UUID supplied by the company.');
          input.company = value.request.company;
        }
        const response = await previewEligibilityRequest(api, input, config(guard));
        guard();
        request = response.data;
        if (
          !request?.previewDigest ||
          request.sharedSummary?.source !== input.source ||
          request.sharedSummary.userAccount !== owner!.ownerAccountUuid ||
          (input.company && request.sharedSummary.company !== input.company) ||
          (input.offering &&
            (request.sharedSummary.offering !== input.offering || request.sharedSummary.quantity !== input.quantity))
        )
          throw createUserFriendlyError('The preview target could not be confirmed.');
        payload = {
          ...input,
          previewDigest: request.previewDigest,
          idempotencyKey: key,
          sharingAccepted: true,
          declarationAccepted: true,
        };
      } else {
        if (
          !record ||
          record.uuid !== value.record ||
          (mode === 'company' ? record.company !== value.company : record.userAccount !== owner!.ownerAccountUuid)
        )
          throw createUserFriendlyError('Load the exact request detail before continuing.');
        if (kind === 'withdrawal') {
          if (!['pending', 'accepted'].includes(record.outcome))
            throw createUserFriendlyError('Only pending or accepted requests may be withdrawn.');
          payload = { idempotencyKey: key };
        } else {
          if (!appointment || !isCurrentEligibilityAppointment(appointment))
            throw createUserFriendlyError('Select your current personal appointment for this company.');
          if (kind === 'decision') {
            if (!appointment.capabilities.some((capability) => capability === 'prepare' || capability === 'approve'))
              throw createUserFriendlyError(
                'Your selected appointment requires personal prepare or approve authority.',
              );
            if (record.outcome !== 'pending')
              throw createUserFriendlyError('This request already has a retained outcome.');
            const input: CompanyEligibilityDecisionPreview = {
              appointment: appointment.uuid,
              outcome: value.decision.outcome,
            };
            if (input.outcome === 'accepted') input.expiresAt = expiry(value.decision.expiresAt);
            else {
              if (!value.decision.reason.trim()) throw createUserFriendlyError('Enter the refusal reason.');
              input.reason = value.decision.reason;
            }
            const response = await previewEligibilityDecision(api, value.company, record.uuid, input, config(guard));
            guard();
            decision = response.data;
            if (!decision?.previewDigest || !Array.isArray(decision.unmetRequirements))
              throw createUserFriendlyError('The decision preview could not be confirmed.');
            payload = { ...input, previewDigest: decision.previewDigest, idempotencyKey: key, confirmation: true };
          } else {
            if (
              record.outcome !== 'accepted' ||
              !record.decision ||
              record.decision.revocation ||
              !appointment.capabilities.includes('approve') ||
              !reason.trim()
            )
              throw createUserFriendlyError(
                'An accepted request, personal approve appointment and revocation reason are required.',
              );
            payload = { appointment: appointment.uuid, idempotencyKey: key, reason };
          }
        }
      }
      guard();
      const target: Command = {
        kind,
        key,
        binding: identity,
        signature: before,
        generation: ticket,
        payload,
        request,
        decision,
        record,
        appointment: appointment?.uuid,
        reason: kind === 'decision' ? ((payload as CompanyEligibilityDecisionCreate).reason ?? '') : reason,
        outcome: kind === 'decision' ? (payload as CompanyEligibilityDecisionCreate).outcome : undefined,
        expiresAt: kind === 'decision' ? ((payload as CompanyEligibilityDecisionCreate).expiresAt ?? null) : undefined,
        uncertain: false,
      };
      active.current = target;
      setAction(target);
    } catch (failure) {
      if (mounted.current && ticket === generation.current)
        setError(getErrorMessage(failure, 'The action could not be prepared. Refresh and try again.'));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const confirm = async (
    target: EligibilityAction,
    checks: { sharingAccepted?: boolean; declarationAccepted?: boolean; confirmation?: boolean },
  ) => {
    const command = active.current;
    if (pending.current || command !== target) return;
    if (
      command.kind === 'request'
        ? checks.sharingAccepted !== true || checks.declarationAccepted !== true || !command.request?.canSubmit
        : checks.confirmation !== true || (command.kind === 'decision' && !command.decision?.canDecide)
    )
      return;
    pending.current = true;
    setBusy(true);
    setError(null);
    let transportStarted = false;
    let dispatched = false;
    try {
      effectGuard(command);
      const guard = () => effectGuard(command);
      const dispatchConfig = config(guard);
      const transforms = dispatchConfig.transformRequest ?? api.defaults.transformRequest;
      const transformers = Array.isArray(transforms) ? transforms : transforms ? [transforms] : [];
      const dispatch: AxiosRequestTransformer = (data) => {
        guard();
        dispatched = true;
        return data;
      };
      dispatchConfig.transformRequest = [...transformers, dispatch];
      transportStarted = true;
      retries.current.set(command.binding, { ...command, uncertain: true });
      const recordId = command.record?.uuid ?? '';
      const companyUuid = command.record?.company ?? '';
      const response =
        command.kind === 'request'
          ? await createEligibilityRequest(api, command.payload as CompanyEligibilityRequestCreate, dispatchConfig)
          : command.kind === 'decision'
            ? await decideEligibilityRequest(
                api,
                companyUuid,
                recordId,
                command.payload as CompanyEligibilityDecisionCreate,
                dispatchConfig,
              )
            : command.kind === 'withdrawal'
              ? await withdrawEligibilityRequest(
                  api,
                  recordId,
                  command.payload as CompanyEligibilityWithdrawalCreate,
                  dispatchConfig,
                )
              : await revokeEligibilityDecision(
                  api,
                  companyUuid,
                  recordId,
                  command.payload as CompanyEligibilityRevocationCreate,
                  dispatchConfig,
                );
      guard();
      const record = response.data;
      const event =
        command.kind === 'request'
          ? record
          : command.kind === 'decision'
            ? record.decision
            : command.kind === 'withdrawal'
              ? record.withdrawal
              : record.decision?.revocation;
      const requestPayload = command.payload as CompanyEligibilityRequestCreate;
      const decisionPayload = command.payload as CompanyEligibilityDecisionCreate;
      const revocationPayload = command.payload as CompanyEligibilityRevocationCreate;
      if (
        (command.kind === 'request' ? ![200, 201].includes(response.status) : response.status !== 200) ||
        !record ||
        !isUuid(record.uuid) ||
        !event ||
        !isUuid(event.uuid) ||
        event.idempotencyKey !== command.key ||
        (recordId && record.uuid !== recordId) ||
        (mode === 'company' ? record.company !== companyUuid : record.userAccount !== owner!.ownerAccountUuid) ||
        (command.kind === 'request' &&
          (record.source !== requestPayload.source ||
            record.company !== command.request?.sharedSummary.company ||
            Date.parse(record.requestedExpiresAt) !== Date.parse(requestPayload.requestedExpiresAt) ||
            JSON.stringify(record.sharedSummary) !== JSON.stringify(command.request?.sharedSummary))) ||
        (command.kind === 'decision' &&
          (record.decision?.appointment !== decisionPayload.appointment ||
            record.decision?.outcome !== decisionPayload.outcome ||
            record.decision?.requestDigest !== command.record?.digest ||
            (decisionPayload.expiresAt
              ? Date.parse(record.decision?.expiresAt ?? '') !== Date.parse(decisionPayload.expiresAt)
              : record.decision?.expiresAt !== null) ||
            record.decision?.reason !== (decisionPayload.reason ?? ''))) ||
        (command.kind === 'revocation' &&
          (record.decision?.revocation?.appointment !== revocationPayload.appointment ||
            record.decision.revocation.reason !== revocationPayload.reason))
      )
        throw createUserFriendlyError(
          'The outcome could not be confirmed. Retry the identical request to recover its retained result.',
        );
      retries.current.delete(command.binding);
      active.current = null;
      setAction(null);
      change({ record: record.uuid });
      await client.invalidateQueries({ queryKey: ['eligibility-records', mode, ...scope] });
    } catch (failure) {
      const original = (failure as { originalError?: unknown }).originalError ?? failure;
      const status = (original as { response?: { status?: number } }).response?.status;
      if (!dispatched || (status && status < 500)) {
        if (transportStarted && !status) retries.current.set(command.binding, { ...command, uncertain: false });
        else retries.current.delete(command.binding);
        if (active.current === command) {
          active.current = null;
          setAction(null);
        }
      } else if (active.current === command) {
        const next = { ...command, uncertain: true };
        active.current = next;
        setAction(next);
      }
      if (mounted.current && boundary.get() === owner && command.generation === generation.current)
        setError(
          getErrorMessage(
            failure,
            'The result is uncertain. Retry this exact confirmation and key, or refresh its retained history.',
          ),
        );
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const relevantReads = mode === 'participant' ? [sources, list] : [appointments, ...(selection.company ? [list] : [])];
  const readError = relevantReads.some((read) => read.isError) || (!!selection.record && detail.isError);
  const preferenceState = client.getQueryState(USER_PREFERENCES_QUERY_KEY);
  const available = !!owner && preferenceState?.status === 'success' && preferenceState.fetchStatus === 'idle';
  const rows = appointments.data ?? [];
  const authorityRows = appointments.isSuccess && !appointments.isFetching ? rows : [];
  const companyReadable =
    mode !== 'company' ||
    (!!selection.company &&
      authorityRows.some(
        (row) =>
          row.company === selection.company &&
          isCurrentEligibilityAppointment(row) &&
          row.capabilities.some((capability) => capability === 'prepare' || capability === 'approve'),
      ));
  const readReady =
    available &&
    companyReadable &&
    !readError &&
    relevantReads.every((read) => read.isSuccess && !read.isFetching) &&
    (!selection.record || (detail.isSuccess && !detail.isFetching));
  const records = readReady ? (list.data ?? []) : [];
  const selectedRecord = readReady && selection.record && detail.isSuccess && !detail.isFetching ? detail.data : null;
  const companies = Array.from(
    new Map(
      authorityRows
        .filter(
          (row) =>
            isCurrentEligibilityAppointment(row) &&
            row.capabilities.some((capability) => capability === 'prepare' || capability === 'approve'),
        )
        .map((row) => [row.company, { uuid: row.company, name: row.companyName }]),
    ).values(),
  );
  return {
    owner: available ? owner : null,
    loading: !!owner && relevantReads.some((read) => read.isPending),
    refreshing: relevantReads.some((read) => read.isFetching) || detail.isFetching,
    error:
      error ??
      (readError
        ? 'These records could not be loaded. Refresh before continuing.'
        : mode === 'company' && selection.company && !companyReadable && !appointments.isFetching
          ? 'Current personal prepare or approve authority is required to read this company’s records.'
          : null),
    refresh,
    records,
    selectedRecord,
    selectRecord: (uuid: string | null) => change({ record: uuid ?? '' }),
    busy,
    action: readReady ? (action as EligibilityAction | null) : null,
    canRetryDecision: readReady && retries.current.has(binding('decision')),
    cancel: retire,
    confirm,
    sources: available && !sources.isError ? (sources.data ?? []) : [],
    appointments: available ? authorityRows : [],
    companies: available ? companies : [],
    companyUuid: selection.company,
    appointmentUuid: selection.appointment,
    setCompany: (uuid: string) => change({ company: uuid, appointment: '', record: '' }),
    setAppointment: (uuid: string) => change({ appointment: uuid }),
    requestDraft: selection.request,
    decisionDraft: selection.decision,
    updateRequest: (patch: Partial<EligibilityRequestDraft>) =>
      change({ request: { ...selected.current.request, ...patch } }),
    updateDecision: (patch: Partial<EligibilityDecisionDraft>) =>
      change({ decision: { ...selected.current.decision, ...patch } }),
    previewRequest: () => prepare('request'),
    previewDecision: () => prepare('decision'),
    prepareWithdrawal: (record: CompanyEligibilityRequest) => {
      if (selected.current.record !== record.uuid) {
        setError('Select and load this request before withdrawing it.');
        return Promise.resolve();
      }
      return prepare('withdrawal');
    },
    prepareRevocation: (record: CompanyEligibilityRequest, reason: string) => {
      if (selected.current.record !== record.uuid) {
        setError('Select and load this request before revoking it.');
        return Promise.resolve();
      }
      return prepare('revocation', reason);
    },
  };
}

export function useParticipantEligibilityRecords(
  api: AxiosInstance,
  newKey: () => string,
  session?: OrderSubmissionSession,
) {
  const read = useEligibilityRecords(api, 'participant', newKey, session);
  return { ...read, draft: read.requestDraft, updateDraft: read.updateRequest };
}

export function useCompanyEligibilityRecords(
  api: AxiosInstance,
  newKey: () => string,
  session?: OrderSubmissionSession,
) {
  const read = useEligibilityRecords(api, 'company', newKey, session);
  return { ...read, draft: read.decisionDraft, updateDraft: read.updateDecision };
}
