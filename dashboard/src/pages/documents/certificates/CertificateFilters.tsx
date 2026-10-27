import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Choices } from '@components/Choices';
import { Field, TextInput } from '@components/Field';
import { Disclosure } from '@components/Ledger';
import { FormActions, PageAction } from '@components/Page';
import { SelectField } from '@components/SelectField';
import type { CertificateClass } from './CertificateRecords';
import { CERTIFICATE_STATUSES, type CertificateFilterValues } from './useCompanyCertificates';

export function CertificateFilters({
  classes,
  selected,
  applied,
  disabled,
  companyReader,
  ownRecord,
}: {
  classes: CertificateClass[];
  selected?: CertificateClass;
  applied: CertificateFilterValues;
  disabled: boolean;
  companyReader: boolean;
  ownRecord: boolean;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const requested = new URLSearchParams(location.search).get('class') ?? selected?.uuid ?? '';
  const version = JSON.stringify([requested, applied.search, applied.status]);
  const [seen, setSeen] = useState(version);
  const [draft, setDraft] = useState({ ...applied, classUuid: requested });
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const returning = useRef(false);
  if (seen !== version) {
    setSeen(version);
    setDraft({ ...applied, classUuid: requested });
    setOpen(false);
  }
  useEffect(() => {
    if (!open && returning.current) {
      returning.current = false;
      toggle.current?.focus();
    }
  }, [open, version]);
  const update = (values: typeof draft) => {
    if (disabled || !CERTIFICATE_STATUSES.some(([value]) => value === values.status)) return;
    const query = new URLSearchParams(location.search);
    if (values.classUuid) query.set('class', values.classUuid);
    else query.delete('class');
    const search = values.search.trim();
    if (search) query.set('q', search);
    else query.delete('q');
    if (values.status !== 'all') query.set('certificate_status', values.status);
    else query.delete('certificate_status');
    query.delete('page');
    setDraft({ ...values, search });
    returning.current = true;
    setOpen(false);
    navigate({ search: query.toString(), hash: location.hash }, { state: location.state });
  };
  const choices = CERTIFICATE_STATUSES.filter(
    ([value]) =>
      value === 'all' ||
      value === 'reversed' ||
      value === applied.status ||
      (value === 'can_prepare' ? companyReader : ownRecord),
  );
  const summary = [
    applied.search ? `“${applied.search}”` : '',
    applied.status === 'all' ? '' : (CERTIFICATE_STATUSES.find(([value]) => value === applied.status)?.[1] ?? ''),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="border-b border-border-subtle">
      <Disclosure
        ref={toggle}
        region
        open={open}
        keepMounted
        onToggle={() => setOpen((value) => !value)}
        summary={
          <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="text-sm font-medium text-text-primary">Filters</span>
            {summary && <span className="min-w-0 break-words text-sm text-text-muted">{summary}</span>}
          </span>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {classes.length > 1 && (
              <SelectField
                label="Share class"
                value={draft.classUuid}
                options={classes.map((item) => ({ value: item.uuid, label: `${item.name} · ${item.symbol}` }))}
                disabled={disabled}
                onChange={(classUuid) => setDraft({ ...draft, classUuid })}
              />
            )}
            <Field label="Shareholder">
              <TextInput
                type="search"
                maxLength={100}
                value={draft.search}
                disabled={disabled}
                onChange={(event) => setDraft({ ...draft, search: event.target.value })}
              />
            </Field>
          </div>
          <Choices
            legend="Certificate status"
            options={choices}
            value={draft.status}
            disabled={disabled}
            onChange={(status) => setDraft({ ...draft, status })}
          />
          <FormActions>
            <PageAction
              label="Clear"
              context="certificate filters"
              disabled={disabled}
              onClick={() => update({ classUuid: requested, search: '', status: 'all' })}
            />
            <PageAction
              label="Apply"
              context="certificate filters"
              primary
              disabled={
                disabled ||
                !classes.some((item) => item.uuid === draft.classUuid) ||
                !CERTIFICATE_STATUSES.some(([value]) => value === draft.status)
              }
              onClick={() => {
                if (classes.some((item) => item.uuid === draft.classUuid)) update(draft);
              }}
            />
          </FormActions>
        </div>
      </Disclosure>
    </div>
  );
}
