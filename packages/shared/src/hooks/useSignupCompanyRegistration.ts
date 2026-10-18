import { USER_PROFILES_QUERY_KEY, SIGNUP_COMPANY_QUERY_KEY, SIGNUP_COMPANY_DETAIL_QUERY_KEY } from './useSignupReview';
import { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { SIGNUP_LOAD_FAILED, SIGNUP_NETWORK_ERROR } from '../constants/business/signup';
import { getCompanies, getCompany, registerCompany, updateCompany } from '../services/companies';
import { getUserProfiles } from '../services/users';
import type { CompanyRegistration, CompanyType } from '../types';
import { apiErrorSentence, readApiError } from '../utils/errors';
import { useApiClient } from './useApiClient';
import { AUTH_QUERY_KEY, useAuth, AUTH_QUERY_ROOT } from './useAuth';
import type { OrderSubmissionSession } from './useOrderSubmissions';
import { useSubmissionOwner } from './useSubmissionOwner';
import { USER_PREFERENCES_QUERY_KEY, useUserPreferences } from './useUserPreferences';

interface CompanyFormData {
  name: string;
  tradingName: string;
  companyType: string;
  acn: string;
  abn: string;
}

type FormErrors = Record<string, string[]>;

const COULD_NOT_SAVE = 'We could not save your company details. Please try again.';

const initialFormData: CompanyFormData = {
  name: '',
  tradingName: '',
  companyType: 'pty',
  acn: '',
  abn: '',
};

export const COMPANY_REGISTRATION_FIELDS = Object.keys(initialFormData) as (keyof CompanyFormData)[];

interface FormOwner {
  uuid: string | null | undefined;
  account: ReturnType<typeof useSubmissionOwner>['owner'];
}

interface FormState {
  owner: FormOwner;
  form: CompanyFormData;
  errors: FormErrors;
  generalError: string;
  dirty: Set<keyof CompanyFormData>;
  hydrated: boolean;
}

interface Submission {
  owner: FormOwner;
  owners: FormOwner[];
  cancelled: boolean;
}

const initialState = (owner: FormOwner): FormState => ({
  owner,
  form: { ...initialFormData },
  errors: {},
  generalError: '',
  dirty: new Set(),
  hydrated: owner.uuid === null,
});

export function useSignupCompanyRegistration(session?: OrderSubmissionSession) {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const { owner: accountOwner, boundary } = useSubmissionOwner(session);
  const auth = useAuth();
  const preferences = useUserPreferences();
  const guard = useCallback(() => {
    if (
      !accountOwner ||
      boundary.get() !== accountOwner ||
      queryClient.getQueryState(USER_PREFERENCES_QUERY_KEY)?.status !== 'success'
    )
      throw new Error('Your signed-in account changed. Reload company setup before continuing.');
  }, [accountOwner, boundary, queryClient]);
  const profilesQuery = useQuery({
    queryKey: [...USER_PROFILES_QUERY_KEY, accountOwner?.userUuid, accountOwner?.ownerAccountUuid],
    queryFn: async () => {
      guard();
      const response = await getUserProfiles(apiClient, { ...session?.requestConfig(), ledovaSubmissionGuard: guard });
      guard();
      if (response.data.results.length !== 1 || response.data.results[0]?.uuid !== accountOwner?.userUuid)
        throw new Error('Your own profile could not be confirmed. Reload company setup.');
      return response;
    },
    enabled: !!accountOwner,
  });
  const companiesQuery = useQuery({
    queryKey: [...SIGNUP_COMPANY_QUERY_KEY, accountOwner?.userUuid, accountOwner?.ownerAccountUuid],
    queryFn: async () => {
      guard();
      const response = await getCompanies(apiClient, undefined, {
        ...session?.requestConfig(),
        ledovaSubmissionGuard: guard,
      });
      guard();
      return response;
    },
    enabled: !!accountOwner,
    staleTime: 0,
  });
  const existingCompany = companiesQuery.data?.data.results[0] || null;
  const selectedUuid = companiesQuery.data ? (existingCompany?.uuid ?? null) : undefined;
  const detailQuery = useQuery({
    queryKey: [
      ...SIGNUP_COMPANY_DETAIL_QUERY_KEY,
      selectedUuid,
      accountOwner?.userUuid,
      accountOwner?.ownerAccountUuid,
    ],
    queryFn: async () => {
      guard();
      const response = await getCompany(apiClient, selectedUuid!, {
        ...session?.requestConfig(),
        ledovaSubmissionGuard: guard,
      });
      guard();
      return response;
    },
    enabled: !!accountOwner && Boolean(selectedUuid),
    staleTime: 0,
  });
  const detail = selectedUuid && detailQuery.data?.data.uuid === selectedUuid ? detailQuery.data.data : null;
  const owner = useMemo(() => ({ uuid: selectedUuid, account: accountOwner }), [selectedUuid, accountOwner]);
  const currentOwner = useRef(owner);
  const mounted = useRef(true);
  const submission = useRef<Submission | null>(null);

  useLayoutEffect(() => {
    currentOwner.current = owner;
    const pending = submission.current;
    if (pending && pending.owners[pending.owners.length - 1] !== owner) pending.owners.push(owner);
  }, [owner]);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (submission.current) submission.current.cancelled = true;
    };
  }, []);

  const [storedState, setState] = useState(() => initialState(owner));
  const state = storedState.owner === owner ? storedState : initialState(owner);
  const { form, errors, generalError } = state;
  const updateState = useCallback(
    (update: (value: FormState) => FormState) => {
      setState((previous) =>
        currentOwner.current === owner ? update(previous.owner === owner ? previous : initialState(owner)) : previous,
      );
    },
    [owner],
  );
  const setErrors = useCallback(
    (value: FormErrors) => updateState((previous) => ({ ...previous, errors: value })),
    [updateState],
  );
  const setGeneralError = useCallback(
    (value: string) => updateState((previous) => ({ ...previous, generalError: value })),
    [updateState],
  );

  useEffect(() => {
    if (!detail) return;
    const saved: CompanyFormData = {
      name: detail.name || '',
      tradingName: detail.tradingName || '',
      companyType: detail.companyType || 'pty',
      acn: detail.acn || '',
      abn: detail.abn || '',
    };
    updateState((previous) => {
      const values = { ...previous.form };
      for (const field of COMPANY_REGISTRATION_FIELDS) if (!previous.dirty.has(field)) values[field] = saved[field];
      if (previous.hydrated && COMPANY_REGISTRATION_FIELDS.every((field) => values[field] === previous.form[field]))
        return previous;
      return { ...previous, form: values, hydrated: true };
    });
  }, [detail, updateState]);

  const userProfile = profilesQuery.data?.data.results?.[0] ?? null;
  const loadFailure =
    preferences.error ?? profilesQuery.error ?? companiesQuery.error ?? (selectedUuid ? detailQuery.error : null);
  const loadError = loadFailure
    ? apiErrorSentence(loadFailure, SIGNUP_LOAD_FAILED, SIGNUP_LOAD_FAILED)
    : !auth.isLoading && !preferences.isLoading && !accountOwner
      ? 'Your signed-in account could not be confirmed. Sign in again or retry company setup.'
      : selectedUuid && detailQuery.isSuccess && !detail
        ? 'Company details did not match the selected company. Please try again.'
        : null;
  const hasLoadedForm = state.hydrated;
  const isLoading =
    !loadError &&
    (auth.isLoading ||
      preferences.isLoading ||
      profilesQuery.isLoading ||
      companiesQuery.isLoading ||
      Boolean(selectedUuid && detailQuery.isLoading) ||
      !hasLoadedForm);
  const canSubmit =
    hasLoadedForm &&
    !loadError &&
    !isLoading &&
    !preferences.isFetching &&
    !profilesQuery.isFetching &&
    !companiesQuery.isFetching &&
    !detailQuery.isFetching &&
    !!accountOwner &&
    userProfile?.uuid === accountOwner.userUuid;

  const registerMutation = useMutation({
    mutationFn: async (data: CompanyRegistration) => {
      guard();
      const response = await registerCompany(apiClient, data, {
        ...session?.requestConfig(),
        ledovaSubmissionGuard: guard,
      });
      guard();
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AUTH_QUERY_ROOT });
      queryClient.invalidateQueries({ queryKey: USER_PREFERENCES_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: SIGNUP_COMPANY_QUERY_KEY });
    },
  });
  const updateMutation = useMutation({
    mutationFn: async (data: { uuid: string; update: Partial<CompanyRegistration> }) => {
      guard();
      const response = await updateCompany(apiClient, data.uuid, data.update, {
        ...session?.requestConfig(),
        ledovaSubmissionGuard: guard,
      });
      guard();
      return response;
    },
    onSuccess: (_response, data) => {
      queryClient.invalidateQueries({ queryKey: SIGNUP_COMPANY_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: [...SIGNUP_COMPANY_DETAIL_QUERY_KEY, data.uuid] });
    },
  });

  const setFieldValue = useCallback(
    (field: keyof CompanyFormData, value: string) => {
      updateState((previous) => {
        const fieldErrors = { ...previous.errors };
        delete fieldErrors[field];
        return {
          ...previous,
          form: { ...previous.form, [field]: value },
          errors: fieldErrors,
          generalError: '',
          dirty: new Set(previous.dirty).add(field),
        };
      });
    },
    [updateState],
  );

  const isCurrentSubmission = useCallback(
    (attempt: Submission, registeredUuid?: string) =>
      mounted.current &&
      !attempt.cancelled &&
      submission.current === attempt &&
      attempt.owners.every(
        (seen) =>
          seen.account === attempt.owner.account &&
          (seen === attempt.owner ||
            (attempt.owner.uuid === null && registeredUuid !== undefined && seen.uuid === registeredUuid)),
      ),
    [],
  );

  const validateForm = useCallback((): boolean => {
    const newErrors: FormErrors = {};

    if (!form.name.trim()) {
      newErrors.name = ['Company name is required'];
    }

    const acnDigits = form.acn.replace(/\s/g, '');
    if (!acnDigits) {
      newErrors.acn = ['ACN is required'];
    } else if (acnDigits.length !== 9) {
      newErrors.acn = ['ACN must be exactly 9 digits'];
    } else if (!/^\d+$/.test(acnDigits)) {
      newErrors.acn = ['ACN must contain only numbers'];
    }

    const abnDigits = form.abn.replace(/\s/g, '');
    if (abnDigits && abnDigits.length !== 11) {
      newErrors.abn = ['ABN must be exactly 11 digits'];
    } else if (abnDigits && !/^\d+$/.test(abnDigits)) {
      newErrors.abn = ['ABN must contain only numbers'];
    }

    const fullName = userProfile?.fullName || '';
    const nameParts = fullName.trim().split(/\s+/);
    if (nameParts.length < 2 || !nameParts[1]) {
      setGeneralError(
        'Please ensure your full name (first and last) is set in your profile before registering a company.',
      );
      return false;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [form, userProfile]);

  const handleSubmit = useCallback(
    async (onSuccess: () => void) => {
      if (currentOwner.current !== owner || !mounted.current || submission.current || !canSubmit || !validateForm())
        return;
      const attempt: Submission = { owner, owners: [owner], cancelled: false };
      submission.current = attempt;
      setGeneralError('');
      try {
        let registeredUuid: string | undefined;
        const fullName = userProfile?.fullName || '';
        const nameParts = fullName.trim().split(/\s+/);
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';
        const phone = userProfile?.phoneNumber
          ? `${userProfile.phoneCountryCode || ''} ${userProfile.phoneNumber}`.trim()
          : undefined;

        if (existingCompany) {
          await updateMutation.mutateAsync({
            uuid: existingCompany.uuid,
            update: {
              name: form.name,
              tradingName: form.tradingName || undefined,
              companyType: form.companyType as CompanyType,
              acn: form.acn.replace(/\s/g, ''),
              abn: form.abn ? form.abn.replace(/\s/g, '') : undefined,
            },
          });
        } else {
          const data: CompanyRegistration = {
            name: form.name,
            tradingName: form.tradingName || undefined,
            companyType: form.companyType as CompanyType,
            acn: form.acn.replace(/\s/g, ''),
            abn: form.abn ? form.abn.replace(/\s/g, '') : undefined,
            primaryContact: { firstName, lastName, phone },
          };
          const response = await registerMutation.mutateAsync(data);
          registeredUuid = response.data.company.uuid;
        }

        if (isCurrentSubmission(attempt, registeredUuid)) onSuccess();
      } catch (err: unknown) {
        if (!isCurrentSubmission(attempt)) return;

        const reading = readApiError(err, {
          fallback: COULD_NOT_SAVE,
          displayedFields: COMPANY_REGISTRATION_FIELDS,
          unanswered: SIGNUP_NETWORK_ERROR,
        });
        setGeneralError(reading.generalError ?? '');
        setErrors(reading.fieldErrors ?? {});
        await queryClient.invalidateQueries({ queryKey: SIGNUP_COMPANY_QUERY_KEY });
      } finally {
        if (submission.current === attempt) submission.current = null;
      }
    },
    [
      owner,
      canSubmit,
      form,
      userProfile,
      existingCompany,
      validateForm,
      registerMutation,
      updateMutation,
      isCurrentSubmission,
      queryClient,
      setGeneralError,
      setErrors,
    ],
  );

  const retryLoad = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: USER_PREFERENCES_QUERY_KEY }),
    ]);
    if (queryClient.getQueryState(USER_PREFERENCES_QUERY_KEY)?.status !== 'success') return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: USER_PROFILES_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: SIGNUP_COMPANY_QUERY_KEY }),
      ...(selectedUuid
        ? [queryClient.invalidateQueries({ queryKey: [...SIGNUP_COMPANY_DETAIL_QUERY_KEY, selectedUuid] })]
        : []),
    ]);
  }, [queryClient, selectedUuid]);

  return {
    form,
    errors,
    generalError,
    loadError,
    hasLoadedForm,
    canSubmit,
    isLoading,
    isSubmitting: registerMutation.isPending || updateMutation.isPending,
    setFieldValue,
    handleSubmit,
    retryLoad,
  };
}
