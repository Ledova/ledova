import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Modal } from '@components/Modal';
import {
  apiErrorSentence,
  createCompanyToken,
  updateCompany,
  wholeShares,
  type Company,
  type CompanyUpdate,
  type TokenType,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { CompanyReadNotice, type CompanyRead } from './CompanyState';

const FIELD_CLASS =
  'mt-1 block w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text-primary';
const EDIT_FIELDS = [
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
interface FormProps {
  company: Company | null;
  target: Company;
  read: CompanyRead;
  onClose: () => void;
  onSuccess: () => Promise<unknown>;
}

function targetAvailable({ company, target, read }: FormProps) {
  return company?.uuid === target.uuid && !read.error && !read.isRefreshing;
}

export function EditCompanyForm(props: FormProps) {
  const { company, target, read, onClose, onSuccess } = props;
  const initial = Object.fromEntries(EDIT_FIELDS.map(([key]) => [key, target[key] ?? ''])) as Draft;
  const [draft, setDraft] = useState(initial);
  const changes = Object.fromEntries(
    Object.entries(draft).filter(([key, value]) => value !== initial[key as keyof Draft]),
  ) as CompanyUpdate;
  const canChangeName = company?.status === 'draft' || company?.status === 'info_required';
  const valid =
    targetAvailable(props) &&
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
  return (
    <Modal
      isOpen
      title="Edit company"
      size="lg"
      showFooter
      confirmLabel="Save changes"
      confirmLoading={save.isPending}
      confirmDisabled={!valid || save.isPending}
      onConfirm={() => {
        if (valid && !save.isPending) save.mutate();
      }}
      onClose={() => {
        if (!save.isPending) onClose();
      }}
    >
      <fieldset disabled={save.isPending} className="space-y-4">
        <CompanyReadNotice read={read} />
        {company?.uuid !== target.uuid && (
          <p role="alert" className="text-sm text-text-muted">
            This draft belongs to a company that is no longer selected.
          </p>
        )}
        {!canChangeName && (
          <p className="text-sm text-text-muted">
            The registered name can change only while the application is a draft or information has been requested.
          </p>
        )}
        {save.isError && (
          <p role="alert" className="text-sm text-error-light">
            {apiErrorSentence(save.error, 'Company changes could not be saved. Try again.')}
          </p>
        )}
        {EDIT_FIELDS.map(([key, label]) => (
          <label key={key} className="block text-sm">
            {label}
            <input
              className={FIELD_CLASS}
              value={draft[key]}
              disabled={key === 'name' && !canChangeName}
              onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
            />
          </label>
        ))}
      </fieldset>
    </Modal>
  );
}

export function CreateClassForm(props: FormProps) {
  const { company, target, read, onClose, onSuccess } = props;
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [tokenType, setTokenType] = useState<TokenType>('ordinary');
  const [totalSupply, setTotalSupply] = useState('');
  const quantity = wholeShares(totalSupply);
  const valid =
    targetAvailable(props) && name.trim() !== '' && symbol.trim() !== '' && quantity !== null && quantity > 0n;
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
  return (
    <Modal
      isOpen
      title="Create share class"
      showFooter
      confirmLabel="Create share class"
      confirmLoading={create.isPending}
      confirmDisabled={!valid || create.isPending}
      onConfirm={() => {
        if (valid && !create.isPending) create.mutate();
      }}
      onClose={() => {
        if (!create.isPending) onClose();
      }}
    >
      <fieldset disabled={create.isPending} className="space-y-4">
        <CompanyReadNotice read={read} />
        {company?.uuid !== target.uuid && (
          <p role="alert" className="text-sm text-text-muted">
            This draft belongs to a company that is no longer selected.
          </p>
        )}
        <p className="text-sm text-text-muted">Create a draft class. Deployment and issuance are separate steps.</p>
        {create.isError && (
          <p role="alert" className="text-sm text-error-light">
            {apiErrorSentence(create.error, 'The share class could not be created. Try again.')}
          </p>
        )}
        <label className="block text-sm">
          Class name
          <input className={FIELD_CLASS} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="block text-sm">
          Symbol
          <input
            className={FIELD_CLASS}
            value={symbol}
            onChange={(event) => setSymbol(event.target.value.toUpperCase())}
          />
        </label>
        <label className="block text-sm">
          Class type
          <select
            className={FIELD_CLASS}
            value={tokenType}
            onChange={(event) => setTokenType(event.target.value as TokenType)}
          >
            <option value="ordinary">Ordinary</option>
            <option value="preference">Preference</option>
            <option value="redeemable">Redeemable</option>
          </select>
        </label>
        <label className="block text-sm">
          Authorised shares
          <input
            className={FIELD_CLASS}
            inputMode="numeric"
            value={totalSupply}
            onChange={(event) => setTotalSupply(event.target.value)}
          />
        </label>
        {totalSupply !== '' && (quantity === null || quantity <= 0n) && (
          <p role="alert" className="text-sm text-error-light">
            Enter a positive whole number of shares.
          </p>
        )}
      </fieldset>
    </Modal>
  );
}
