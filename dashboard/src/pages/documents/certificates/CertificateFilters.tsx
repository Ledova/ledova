import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { FunnelIcon } from '@phosphor-icons/react';
import { Field, TextInput } from '@components/Field';
import { ICON_MD } from '@components/iconSizes';
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
  const toggle = useRef<HTMLButtonElement>(null);
  const returning = useRef(false);
  if (seen !== version) {
    setSeen(version);
    setDraft({ ...applied, classUuid: requested });
  }
  useEffect(() => {
    if (returning.current) {
      returning.current = false;
      toggle.current?.focus();
    }
  }, [version]);
  const update = (values: typeof draft, close: () => void) => {
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
    returning.current = version !== JSON.stringify([values.classUuid, search, values.status]);
    close();
    navigate({ search: query.toString(), hash: location.hash }, { state: location.state });
  };
  const choices = CERTIFICATE_STATUSES.filter(
    ([value]) =>
      value === 'all' ||
      value === 'reversed' ||
      value === applied.status ||
      (value === 'can_prepare' ? companyReader : ownRecord),
  );
  return (
    <Popover key={version} className="shrink-0">
      <PopoverButton
        ref={toggle}
        aria-label="Filters"
        title="Filters"
        className={`inline-flex h-10 w-10 items-center justify-center rounded-lg border transition-colors hover:bg-surface-tertiary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-mid ${applied.search || applied.status !== 'all' ? 'border-brand-mid text-brand-light' : 'border-border text-text-primary'}`}
      >
        <FunnelIcon size={ICON_MD} aria-hidden="true" />
      </PopoverButton>
      <PopoverPanel
        anchor="bottom end"
        focus
        className="z-50 flex max-h-[calc(100dvh-2rem)] w-80 max-w-[calc(100vw-2rem)] flex-col gap-4 overflow-y-auto rounded-lg border border-border bg-surface-raised p-4 shadow-lg [--anchor-gap:8px] [--anchor-padding:16px]"
      >
        {({ close }) => (
          <>
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
            <SelectField
              label="Certificate status"
              options={choices.map(([value, label]) => ({ value, label }))}
              value={draft.status}
              disabled={disabled}
              onChange={(status) => {
                const choice = choices.find(([value]) => value === status);
                if (choice) setDraft({ ...draft, status: choice[0] });
              }}
            />
            <FormActions>
              <PageAction
                label="Clear"
                context="certificate filters"
                disabled={disabled}
                onClick={() => update({ classUuid: requested, search: '', status: 'all' }, close)}
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
                  if (classes.some((item) => item.uuid === draft.classUuid)) update(draft, close);
                }}
              />
            </FormActions>
          </>
        )}
      </PopoverPanel>
    </Popover>
  );
}
