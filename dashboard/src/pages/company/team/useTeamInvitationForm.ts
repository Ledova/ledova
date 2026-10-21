import {
  addCalendarDays,
  createCompanyTeamInvitation,
  type CompanyCapability,
  type OwnCompanyAppointment,
  failureSentence,
  isCalendarDate,
  utcToday,
} from '@ledova/shared';
import { hasProblems, type Problems } from '@hooks/useErrorSummary';
import { useIncompleteDates } from '@hooks/useIncompleteDates';
import { sameScope } from '@pages/company/shared/appointments';
import apiClient from '@services/apiClient';
import { useEffect, useRef, useState } from 'react';

export function useTeamInvitationForm({
  source,
  available,
  disabled,
  guard,
  onRecorded,
  onBusy,
}: {
  source: OwnCompanyAppointment;
  available: CompanyCapability[];
  disabled: boolean;
  guard: () => void;
  onRecorded: () => void;
  onBusy: (value: boolean) => void;
}) {
  const [personal, setPersonal] = useState<CompanyCapability[]>([]);
  const [delegatable, setDelegatable] = useState<CompanyCapability[]>([]);
  const [deadline, setDeadline] = useState('');
  const [expiry, setExpiry] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recorded, setRecorded] = useState<{ code: string | null } | null>(null);
  const keyRef = useRef<string | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const check = () => {
    guard();
    if (!mounted.current) throw new Error('Your selected appointment changed. Reopen the invitation.');
  };
  const change = (apply: () => void) => {
    keyRef.current = null;
    setError('');
    apply();
  };
  const toggle = (values: CompanyCapability[], value: CompanyCapability) =>
    values.includes(value) ? values.filter((item) => item !== value) : [...values, value].sort();
  const today = utcToday();
  const dates = useIncompleteDates<'deadline' | 'expiry'>();
  const problems: Problems<'actions' | 'deadline' | 'expiry'> = {
    actions: !personal.length && !delegatable.length && 'Choose at least one action for the appointee or to delegate.',
    deadline:
      (dates.incomplete.deadline ||
        (!!deadline && (!isCalendarDate(deadline) || deadline < today || deadline > addCalendarDays(today, 29)))) &&
      'Enter an invitation deadline from today to 29 days ahead (UTC), or clear it.',
    expiry:
      (dates.incomplete.expiry || (!!expiry && (!isCalendarDate(expiry) || expiry < today))) &&
      'Enter an appointment expiry no earlier than today (UTC), or clear it.',
  };
  const send = async () => {
    if (disabled || pending.current || recorded || hasProblems(problems)) return;
    pending.current = true;
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      check();
      if (![...personal, ...delegatable].every((value) => available.includes(value)))
        throw new Error('Your delegation scope changed. Choose the permitted actions again.');
      keyRef.current ??= crypto.randomUUID();
      const { data, status } = await createCompanyTeamInvitation(
        apiClient,
        {
          company: source.company,
          inviterAppointment: source.uuid,
          idempotencyKey: keyRef.current,
          capabilities: personal,
          delegatableCapabilities: delegatable,
          ...(deadline ? { acceptanceDeadline: `${deadline}T23:59:59Z` } : {}),
          ...(expiry ? { appointmentExpiresAt: `${expiry}T23:59:59Z` } : {}),
        },
        { ledovaSubmissionGuard: check },
      );
      check();
      if (
        typeof data.uuid !== 'string' ||
        !data.uuid ||
        data.company !== source.company ||
        data.inviterAppointment !== source.uuid ||
        data.idempotencyKey !== keyRef.current ||
        !sameScope(data.capabilities, personal) ||
        !sameScope(data.delegatableCapabilities, delegatable) ||
        (deadline && Date.parse(data.acceptanceDeadline) !== Date.parse(`${deadline}T23:59:59Z`)) ||
        (expiry
          ? Date.parse(data.appointmentExpiresAt ?? '') !== Date.parse(`${expiry}T23:59:59Z`)
          : data.appointmentExpiresAt !== null) ||
        !Number.isFinite(Date.parse(data.acceptanceDeadline)) ||
        !(
          (status === 200 && data.code === null) ||
          (status === 201 && typeof data.code === 'string' && /^[A-Za-z0-9_-]{43}$/.test(data.code))
        )
      )
        throw new Error('The invitation outcome could not be confirmed. Retry with the same details.');
      setRecorded({ code: data.code });
      onRecorded();
    } catch (failure) {
      if (mounted.current) {
        try {
          guard();
          setError(failureSentence(failure, 'The invitation could not be recorded. Retry with the same details.'));
        } catch {
          return;
        }
      }
    } finally {
      pending.current = false;
      onBusy(false);
      if (mounted.current) setBusy(false);
    }
  };
  return {
    personal,
    setPersonal,
    delegatable,
    setDelegatable,
    deadline,
    setDeadline,
    expiry,
    setExpiry,
    busy,
    error,
    problems,
    watchDate: dates.watch,
    recorded,
    setRecorded,
    keyRef,
    change,
    toggle,
    send,
  };
}
