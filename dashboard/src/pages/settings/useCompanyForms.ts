import { FIELD_LIMITS, createUserFriendlyError, updateCompany, type Company, type CompanyUpdate } from '@ledova/shared';
import { type CompanyActionRead } from '@components/CompanyState';
import apiClient from '@services/apiClient';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { Problems } from '@hooks/useErrorSummary';
export const EDIT_FIELDS = [
  ['name', 'Company name', FIELD_LIMITS.COMPANY_NAME],
  ['tradingName', 'Trading name', FIELD_LIMITS.COMPANY_NAME],
  ['addressLine1', 'Address line 1', FIELD_LIMITS.ADDRESS_LINE],
  ['addressLine2', 'Address line 2', FIELD_LIMITS.ADDRESS_LINE],
  ['city', 'City', FIELD_LIMITS.CITY],
  ['state', 'State', FIELD_LIMITS.STATE],
  ['postcode', 'Postcode', FIELD_LIMITS.POSTCODE],
  ['phone', 'Phone', FIELD_LIMITS.COMPANY_PHONE],
] as const;
type Draft = Record<(typeof EDIT_FIELDS)[number][0], string>;
export interface FormProps {
  company: Company | null;
  target: Company;
  read: CompanyActionRead;
  onClose: () => void;
  onSuccess: () => Promise<unknown>;
}
function targetAvailable({ company, target, read }: FormProps) {
  return company?.uuid === target.uuid && !read.error && !read.isRefreshing;
}
export function useEditCompanyForm(props: FormProps) {
  const { company, target, read, onClose, onSuccess } = props;
  const initial = Object.fromEntries(EDIT_FIELDS.map(([key]) => [key, target[key] ?? ''])) as Draft;
  const [draft, setDraft] = useState(initial);
  const pendingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [assertCurrent] = useState(() => read.assertCurrent);
  const guard = (uuid: string, mode: 'admin' | 'owner' = 'admin') => {
    if (!mounted.current) throw createUserFriendlyError('This company action is closed. Reopen it before continuing.');
    assertCurrent(uuid, mode);
  };
  const [config] = useState(() => read.requestConfig(target.uuid));
  const changes = Object.fromEntries(
    Object.entries(draft).filter(([key, value]) => value !== initial[key as keyof Draft]),
  ) as CompanyUpdate;
  const canChangeName = company?.status === 'draft' || company?.status === 'info_required';
  const changed = Object.keys(changes).length > 0;
  const available = targetAvailable(props) && !!company && read.canAdmin && changed && (!changes.name || canChangeName);
  const problems: Problems<keyof Draft> = { name: !draft.name.trim() && 'Give the company name.' };
  const save = useMutation({
    mutationFn: async () => {
      guard(target.uuid);
      const result = await updateCompany(apiClient, target.uuid, changes, {
        ...config,
        ledovaSubmissionGuard: () => guard(target.uuid),
      });
      guard(target.uuid);
      if (
        result.data.uuid !== target.uuid ||
        !Array.isArray(result.data.documents) ||
        Object.entries(changes).some(([key, value]) => result.data[key as keyof typeof result.data] !== value)
      )
        throw createUserFriendlyError('The company changes could not be confirmed. Refresh before retrying.');
      return result;
    },
    onSuccess: async () => {
      guard(target.uuid);
      await onSuccess();
      guard(target.uuid);
      onClose();
    },
    onSettled: () => {
      pendingRef.current = false;
    },
  });
  return {
    company,
    target,
    read,
    onClose,
    draft,
    setDraft,
    pendingRef,
    canChangeName,
    changed,
    available,
    problems,
    save,
  };
}
