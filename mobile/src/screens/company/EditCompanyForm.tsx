import { useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { apiErrorSentence, updateCompany, type Company, type CompanyUpdate } from '@ledova/shared';
import { CustomModal } from '../../components/modal';
import { apiClient } from '../../services/apiClient';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { CompanyReadNotice, type CompanyActionRead } from '../../components/company/CompanyState';

const FIELDS = [
  ['name', 'Company name'],
  ['tradingName', 'Trading name'],
  ['addressLine1', 'Address line 1'],
  ['addressLine2', 'Address line 2'],
  ['city', 'City'],
  ['state', 'State'],
  ['postcode', 'Postcode'],
  ['phone', 'Phone'],
] as const;
type Draft = Record<(typeof FIELDS)[number][0], string>;
interface Props {
  target: Company;
  company: Company | null;
  read: CompanyActionRead;
  onClose: () => void;
  onSuccess: () => Promise<unknown>;
}

export function EditCompanyForm({ target, company, read, onClose, onSuccess }: Props) {
  const styles = useCompanyStyles();
  const initial = Object.fromEntries(FIELDS.map(([key]) => [key, target[key] ?? ''])) as Draft;
  const [draft, setDraft] = useState(initial);
  const pending = useRef(false);
  const mounted = useRef(true);
  const [authority] = useState(() => read.assertCurrent);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [guard] = useState(() => () => {
    if (!mounted.current) throw new Error('This company draft is no longer open.');
    authority(target.uuid);
  });
  const [config] = useState(() => ({ ...read.requestConfig(target.uuid), ledovaSubmissionGuard: guard }));
  const changes = Object.fromEntries(
    Object.entries(draft).filter(([key, value]) => value !== initial[key as keyof Draft]),
  ) as CompanyUpdate;
  const canChangeName = company?.status === 'draft' || company?.status === 'info_required';
  const valid =
    company?.uuid === target.uuid &&
    read.canAdmin &&
    !read.error &&
    !read.isRefreshing &&
    Object.keys(changes).length > 0 &&
    (!changes.name || canChangeName) &&
    draft.name.trim() !== '';
  const save = useMutation({
    mutationFn: async (input: CompanyUpdate) => {
      guard();
      const response = await updateCompany(apiClient, target.uuid, input, config);
      guard();
      if (
        response.data.uuid !== target.uuid ||
        !Array.isArray(response.data.documents) ||
        Object.entries(input).some(([key, value]) => response.data[key as keyof typeof response.data] !== value)
      )
        throw new Error('The company changes could not be confirmed. Refresh before retrying.');
      return response;
    },
    onSuccess: async () => {
      guard();
      await onSuccess();
      guard();
      onClose();
    },
    onSettled: () => {
      pending.current = false;
    },
  });
  const close = () => {
    if (!save.isPending) onClose();
  };
  return (
    <CustomModal
      visible
      title="Edit company"
      onClose={close}
      busy={save.isPending}
      showFooter
      onConfirm={() => {
        if (valid && mounted.current && !pending.current) {
          pending.current = true;
          save.mutate(changes);
        }
      }}
      confirmLabel="Save changes"
      confirmDisabled={!valid || save.isPending}
    >
      <View style={styles.group}>
        <CompanyReadNotice read={read} />
        {company?.uuid !== target.uuid && (
          <Text accessibilityRole="alert" style={styles.error}>
            This draft belongs to a company that is no longer selected.
          </Text>
        )}
        {!canChangeName && (
          <Text style={styles.muted}>
            The registered name can change only while the application is a draft or information has been requested.
          </Text>
        )}
        {save.isError && (
          <Text accessibilityRole="alert" style={styles.error}>
            {apiErrorSentence(save.error, 'Company changes could not be saved. Try again.')}
          </Text>
        )}
        {FIELDS.map(([key, label]) => (
          <View style={styles.group} key={key}>
            <Text style={styles.text}>{label}</Text>
            <TextInput
              accessibilityLabel={label}
              style={styles.input}
              value={draft[key]}
              editable={!save.isPending && (key !== 'name' || canChangeName)}
              onChangeText={(value) => setDraft({ ...draft, [key]: value })}
            />
          </View>
        ))}
      </View>
    </CustomModal>
  );
}
