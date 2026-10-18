import { useLayoutEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AUTH_QUERY_KEY,
  USER_PREFERENCES_QUERY_KEY,
  appointmentForRegisterStep,
  type OwnCompanyAppointment,
  useSubmissionOwner,
} from '@ledova/shared';
import { assertSessionEpoch } from '../services/sessionScope';
import { orderSubmissionSession } from '../services/orderSubmissions';
import {
  registerAppointmentsKey,
  registerClassesKey,
  useRegisterAppointments,
  useRegisterClasses,
} from './useCompanyRegister';

export function useRegisterClassCreation(epoch: number, companyUuid: string | undefined) {
  const client = useQueryClient();
  const { owner, boundary } = useSubmissionOwner(orderSubmissionSession);
  const classes = useRegisterClasses(epoch);
  const { appointments, steps } = useRegisterAppointments(epoch, companyUuid ?? '');
  const selected = useRef(companyUuid);
  const live = useRef(true);
  useLayoutEffect(() => {
    selected.current = companyUuid;
  }, [companyUuid]);
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const appointment = steps?.prepare;
  const error = classes.error || appointments.error;
  const isRefreshing = classes.isFetching || appointments.isFetching;
  const canPrepare = !!owner && !!appointment && !appointment.revokedAt && !error && !isRefreshing;
  const assertCurrent = (company: string) => {
    assertSessionEpoch(epoch);
    if (!owner || boundary.get() !== owner)
      throw new Error('Your signed-in account changed. Reopen this share class draft.');
    if (!live.current || !company || selected.current !== company)
      throw new Error('The selected company changed. Reopen this share class draft.');
    for (const key of [
      AUTH_QUERY_KEY,
      USER_PREFERENCES_QUERY_KEY,
      registerClassesKey(epoch),
      registerAppointmentsKey(epoch),
    ]) {
      const state = client.getQueryState(key);
      if (state?.status !== 'success' || state.fetchStatus !== 'idle')
        throw new Error('Refresh the share classes and your current company appointments.');
    }
    const current = appointmentForRegisterStep(
      client.getQueryData<OwnCompanyAppointment[]>(registerAppointmentsKey(epoch)) ?? [],
      company,
      'prepare',
    );
    if (!current || current.revokedAt || current.uuid !== appointment?.uuid)
      throw new Error('Your company appointment changed. Reopen this share class draft.');
  };
  const refetch = async () => {
    const [classResult] = await Promise.all([classes.refetch(), appointments.refetch()]);
    assertSessionEpoch(epoch);
    if (!owner || boundary.get() !== owner)
      throw new Error('Your signed-in account changed. Reopen this share class draft.');
    if (!live.current || selected.current !== companyUuid) throw new Error('The selected company changed.');
    return { classes: classResult };
  };
  return {
    companyUuid,
    classes,
    canPrepare,
    error,
    isRefreshing,
    assertCurrent,
    refetch,
    requestConfig: (company: string) => ({
      ledovaSessionEpoch: epoch,
      ledovaSubmissionGuard: () => assertCurrent(company),
    }),
  };
}
