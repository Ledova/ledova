import { createUserFriendlyError, updateCompany, type Company, type CompanyUpdate } from '@ledova/shared';
import { type CompanyActionRead } from '@pages/company/shared/CompanyState';
import apiClient from '@services/apiClient';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
export const EDIT_FIELDS = [
  ['name', 'Company name'],
  ['tradingName', 'Trading name'],
  ['addressLine1', 'Address line 1'],
  ['addressLine2', 'Address line 2'],
  ['city', 'City'],
  ['state', 'State'],
  ['postcode', 'Postcode'],
  ['phone', 'Phone'],
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
  const valid =
    targetAvailable(props) &&
    !!company &&
    read.canAdmin &&
    Object.keys(changes).length > 0 &&
    (!changes.name || canChangeName) &&
    draft.name.trim() !== '';
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
  return { company, target, read, onClose, draft, setDraft, pendingRef, canChangeName, valid, save };
}
