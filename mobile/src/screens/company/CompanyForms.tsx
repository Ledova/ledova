import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import {
  apiErrorSentence,
  createCompanyToken,
  updateCompany,
  wholeShares,
  type Company,
  type CompanyUpdate,
  type TokenType,
} from '@ledova/shared';
import { CompanyModal } from './CompanyModal';
import { Action } from '../../components/Ledger';
import { apiClient } from '../../services/apiClient';
import { useCompanyStyles } from '../company-register/styles';
import { CompanyReadNotice, type CompanyRead } from './CompanyState';

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
  read: CompanyRead;
  onClose: () => void;
  onSuccess: () => Promise<unknown>;
}

export function EditCompanyForm({ target, company, read, onClose, onSuccess }: Props) {
  const styles = useCompanyStyles();
  const initial = Object.fromEntries(FIELDS.map(([key]) => [key, target[key] ?? ''])) as Draft;
  const [draft, setDraft] = useState(initial);
  const changes = Object.fromEntries(
    Object.entries(draft).filter(([key, value]) => value !== initial[key as keyof Draft]),
  ) as CompanyUpdate;
  const canChangeName = company?.status === 'draft' || company?.status === 'info_required';
  const valid =
    company?.uuid === target.uuid &&
    !read.error &&
    !read.isRefreshing &&
    Object.keys(changes).length > 0 &&
    (!changes.name || canChangeName) &&
    draft.name.trim() !== '';
  const save = useMutation({
    mutationFn: () => updateCompany(apiClient, target.uuid, changes),
    onSuccess: async () => {
      await onSuccess();
      onClose();
    },
  });
  const close = () => {
    if (!save.isPending) onClose();
  };
  return (
    <CompanyModal onClose={close}>
      <View style={styles.group}>
        <Text accessibilityRole="header" style={styles.heading}>
          Edit company
        </Text>
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
        <Action
          label="Save changes"
          primary
          disabled={!valid || save.isPending}
          onPress={() => {
            if (valid && !save.isPending) save.mutate();
          }}
        />
        <Action label="Cancel" disabled={save.isPending} onPress={close} />
      </View>
    </CompanyModal>
  );
}

export function CreateClassForm({ target, company, read, onClose, onSuccess }: Props) {
  const styles = useCompanyStyles();
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [tokenType, setTokenType] = useState<TokenType>('ordinary');
  const [totalSupply, setTotalSupply] = useState('');
  const quantity = wholeShares(totalSupply);
  const valid =
    company?.uuid === target.uuid &&
    !read.error &&
    !read.isRefreshing &&
    name.trim() !== '' &&
    symbol.trim() !== '' &&
    quantity !== null &&
    quantity > 0n;
  const create = useMutation({
    mutationFn: () =>
      createCompanyToken(apiClient, {
        company: target.uuid,
        name: name.trim(),
        symbol: symbol.trim(),
        tokenType,
        totalSupply,
      }),
    onSuccess: async () => {
      await onSuccess();
      onClose();
    },
  });
  const close = () => {
    if (!create.isPending) onClose();
  };
  return (
    <CompanyModal onClose={close}>
      <View style={styles.group}>
        <Text accessibilityRole="header" style={styles.heading}>
          Create share class
        </Text>
        <CompanyReadNotice read={read} />
        {company?.uuid !== target.uuid && (
          <Text accessibilityRole="alert" style={styles.error}>
            This draft belongs to a company that is no longer selected.
          </Text>
        )}
        <Text style={styles.muted}>Create a draft class. Deployment and issuance are separate steps.</Text>
        {create.isError && (
          <Text accessibilityRole="alert" style={styles.error}>
            {apiErrorSentence(create.error, 'The share class could not be created. Try again.')}
          </Text>
        )}
        <Text style={styles.text}>Class name</Text>
        <TextInput
          accessibilityLabel="Class name"
          style={styles.input}
          value={name}
          editable={!create.isPending}
          onChangeText={setName}
        />
        <Text style={styles.text}>Symbol</Text>
        <TextInput
          accessibilityLabel="Symbol"
          style={styles.input}
          value={symbol}
          editable={!create.isPending}
          onChangeText={(value) => setSymbol(value.toUpperCase())}
        />
        <Text style={styles.text}>Class type: {tokenType}</Text>
        {(['ordinary', 'preference', 'redeemable'] as const).map((type) => (
          <Action
            key={type}
            label={type[0].toUpperCase() + type.slice(1)}
            primary={tokenType === type}
            disabled={create.isPending}
            onPress={() => setTokenType(type)}
          />
        ))}
        <Text style={styles.text}>Authorised shares</Text>
        <TextInput
          accessibilityLabel="Authorised shares"
          style={styles.input}
          value={totalSupply}
          editable={!create.isPending}
          keyboardType="number-pad"
          onChangeText={setTotalSupply}
        />
        {totalSupply !== '' && (quantity === null || quantity <= 0n) && (
          <Text accessibilityRole="alert" style={styles.error}>
            Enter a positive whole number of shares.
          </Text>
        )}
        <Action
          label="Create share class"
          primary
          disabled={!valid || create.isPending}
          onPress={() => {
            if (valid && !create.isPending) create.mutate();
          }}
        />
        <Action label="Cancel" disabled={create.isPending} onPress={close} />
      </View>
    </CompanyModal>
  );
}
