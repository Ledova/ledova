import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { awaitsActivation } from '../constants';
import { activateCompany } from '../services/companies';
import type { Company, CompanyActivate, CompanyActivationAttempt } from '../types';
import { createUserFriendlyError, failureStatus, failureSentence } from '../utils/errors';
import { isUuid } from '../utils/validation';
import { ownCompaniesKey, type useCompanySelection } from './useCompanySelection';
import { useApiClient } from './useApiClient';
import { OWN_APPOINTMENTS_QUERY_KEY } from './useCompanyEligibilityRecords';

type Selection = ReturnType<typeof useCompanySelection>;
type Preview = {
  company: string;
  name: string;
  signature: string;
  request: CompanyActivate;
  text: string;
};

function activationSignature(company: Company) {
  const value = company.activation;
  if (
    !value ||
    !isUuid(value.appointment) ||
    !Number.isInteger(value.lifecycleRevision) ||
    value.lifecycleRevision < 0 ||
    value.declarationVersion !== '2026-10-04' ||
    !value.declarationText?.trim()
  )
    throw createUserFriendlyError('Refresh your current company appointment and declaration before activating.');
  return JSON.stringify([
    company.uuid,
    company.name,
    company.acn,
    company.abn,
    company.status,
    value.appointment,
    value.lifecycleRevision,
    value.declarationVersion,
    value.declarationText,
  ]);
}

export function useCompanyActivation(read: Selection, newKey: () => string) {
  const apiClient = useApiClient();
  const client = useQueryClient();
  const mounted = useRef(true);
  const pending = useRef(false);
  const confirmation = useRef<Preview | null>(null);
  const retry = useRef<{ signature: string; key: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = () => {
    if (!mounted.current || !read.companyUuid)
      throw createUserFriendlyError('This activation is closed. Reopen it before continuing.');
    read.assertCurrent(read.companyUuid, 'personal');
    const company = client.getQueryData<Company>(read.companyKey);
    if (!company || company.uuid !== read.companyUuid) throw createUserFriendlyError('The selected company changed.');
    return { company, signature: activationSignature(company) };
  };
  const guard = (target: Preview) => {
    const value = current();
    if (
      confirmation.current !== target ||
      value.company.uuid !== target.company ||
      value.signature !== target.signature
    )
      throw createUserFriendlyError('Your appointment, company or declaration changed. Review activation again.');
    return value.company;
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      confirmation.current = null;
      retry.current = null;
    };
  }, []);
  useEffect(() =>
    client.getQueryCache().subscribe(() => {
      const target = confirmation.current;
      if (!target) return;
      try {
        guard(target);
      } catch {
        confirmation.current = null;
        if (mounted.current) setPreview(null);
      }
    }),
  );
  const open = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    confirmation.current = null;
    setPreview(null);
    try {
      await read.refetch();
      const { company, signature } = current();
      if (!awaitsActivation(company))
        throw createUserFriendlyError('This company cannot be activated through onboarding.');
      const activation = company.activation!;
      const key = retry.current?.signature === signature ? retry.current.key : newKey();
      const target: Preview = {
        company: company.uuid,
        name: company.name,
        signature,
        text: activation.declarationText,
        request: {
          idempotencyKey: key,
          appointment: activation.appointment!,
          lifecycleRevision: activation.lifecycleRevision,
          declarationVersion: activation.declarationVersion,
          acceptDeclaration: true,
        },
      };
      confirmation.current = target;
      setPreview(target);
    } catch (failure) {
      if (mounted.current)
        setError(failureSentence(failure, 'Activation could not be prepared. Refresh and try again.'));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const confirm = async (target: Preview) => {
    if (pending.current || confirmation.current !== target) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const before = guard(target);
      retry.current = { signature: target.signature, key: target.request.idempotencyKey };
      const result = await activateCompany(apiClient, target.company, target.request, {
        ...read.requestConfig(target.company, 'personal'),
        ledovaSubmissionGuard: () => guard(target),
      });
      guard(target);
      const { company, attempt } = result.data;
      if (
        result.status !== 200 ||
        !company ||
        !attempt ||
        company.uuid !== target.company ||
        !isUuid(attempt.uuid) ||
        typeof attempt.reason !== 'string' ||
        !Number.isFinite(Date.parse(attempt.startedAt)) ||
        (attempt.completedAt !== null && !Number.isFinite(Date.parse(attempt.completedAt))) ||
        (attempt.appliedAt !== null && !Number.isFinite(Date.parse(attempt.appliedAt))) ||
        attempt.idempotencyKey !== target.request.idempotencyKey ||
        attempt.appointment !== target.request.appointment ||
        attempt.lifecycleRevision !== target.request.lifecycleRevision ||
        attempt.declarationVersion !== target.request.declarationVersion ||
        attempt.declarationText !== target.text ||
        !['pending', 'passed', 'failed'].includes(attempt.status) ||
        (attempt.appliedAt
          ? attempt.status !== 'passed' || company.status !== 'active'
          : company.status !== before.status)
      )
        throw createUserFriendlyError('The activation outcome could not be confirmed. Refresh before retrying.');
      confirmation.current = null;
      retry.current = null;
      setPreview(null);
      await Promise.all([
        client.invalidateQueries({ queryKey: read.companyKey }),
        client.invalidateQueries({ queryKey: ownCompaniesKey(read.owner) }),
        client.invalidateQueries({ queryKey: OWN_APPOINTMENTS_QUERY_KEY }),
      ]);
    } catch (failure) {
      const response = (failure as { response?: unknown })?.response;
      const status = failureStatus(failure);
      if (response && status && status < 500) retry.current = null;
      if (mounted.current) {
        try {
          current();
          setError(failureSentence(failure, 'Activation was not confirmed. Retry the same request after refreshing.'));
        } catch {}
      }
      confirmation.current = null;
      if (mounted.current) setPreview(null);
      if (status === 400 || status === 404 || status === 409) await read.refetch();
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const company = read.company;
  const activation = read.canPersonalAdmin ? company?.activation : null;
  const latestAttempt: CompanyActivationAttempt | null = activation?.latestAttempt ?? null;
  return {
    preview: read.canPersonalAdmin ? preview : null,
    busy,
    error,
    latestAttempt,
    canActivate: !!activation?.appointment && !!company && awaitsActivation(company) && !busy,
    open,
    confirm,
    cancel: () => {
      if (pending.current) return;
      confirmation.current = null;
      setPreview(null);
    },
  };
}
