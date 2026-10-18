import { FIELD_CLASS } from '@components/fieldClass';
import { Modal } from '@components/Modal';
import { apiErrorSentence, type TokenType } from '@ledova/shared';
import { CompanyReadNotice } from '@pages/company/shared/CompanyState';
import { EDIT_FIELDS, useCreateClassForm, useEditCompanyForm, type FormProps } from './useCompanyForms';

export function EditCompanyForm(props: FormProps) {
  const { company, target, read, onClose, draft, setDraft, pendingRef, canChangeName, valid, save } =
    useEditCompanyForm(props);
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
        if (valid && !pendingRef.current) {
          pendingRef.current = true;
          save.mutate();
        }
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
            {apiErrorSentence(
              save.error,
              'Company changes could not be saved. Try again.',
              'The company changes could not be confirmed. Refresh before retrying.',
            )}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {EDIT_FIELDS.map(([key, label]) => (
            <label
              key={key}
              className={`block text-sm ${['name', 'addressLine1', 'addressLine2'].includes(key) ? 'sm:col-span-2' : ''}`}
            >
              {label}
              <input
                className={FIELD_CLASS}
                value={draft[key]}
                disabled={key === 'name' && !canChangeName}
                onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
              />
            </label>
          ))}
        </div>
      </fieldset>
    </Modal>
  );
}

export function CreateClassForm(props: FormProps) {
  const {
    company,
    target,
    read,
    onClose,
    name,
    setName,
    symbol,
    setSymbol,
    tokenType,
    setTokenType,
    totalSupply,
    setTotalSupply,
    pendingRef,
    quantity,
    valid,
    create,
  } = useCreateClassForm(props);
  return (
    <Modal
      isOpen
      title="Create share class"
      showFooter
      confirmLabel="Create share class"
      confirmLoading={create.isPending}
      confirmDisabled={!valid || create.isPending}
      onConfirm={() => {
        if (valid && !pendingRef.current) {
          pendingRef.current = true;
          create.mutate();
        }
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
