import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FilterPopover } from '@components/FilterPopover';
import { Field, TextInput } from '@components/Field';
import { FormActions, PageAction } from '@components/Page';
import { SelectField } from '@components/SelectField';
import type { CertificateClass } from './CertificateRecords';
import { CERTIFICATE_STATUSES } from '@ledova/shared';
import type { CertificateFilterValues } from './useCompanyCertificates';

const UNFILTERED: CertificateFilterValues = { search: '', status: 'all' };

export function CertificateFilters({
  classes,
  selected,
  applied,
  disabled,
}: {
  classes: CertificateClass[];
  selected?: CertificateClass;
  applied?: CertificateFilterValues;
  disabled: boolean;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const current = applied ?? UNFILTERED;
  const requested = new URLSearchParams(location.search).get('class') ?? selected?.uuid ?? '';
  const version = JSON.stringify([requested, current.search, current.status]);
  const [seen, setSeen] = useState(version);
  const [draft, setDraft] = useState({ ...current, classUuid: requested });
  const toggle = useRef<HTMLButtonElement>(null);
  const returning = useRef(false);
  if (seen !== version) {
    setSeen(version);
    setDraft({ ...current, classUuid: requested });
  }
  useEffect(() => {
    if (returning.current) {
      returning.current = false;
      toggle.current?.focus();
    }
  }, [version]);
  if (!applied && classes.length < 2) return null;
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
  return (
    <FilterPopover ref={toggle} resetKey={version} active={!!current.search || current.status !== 'all'}>
      {(close) => (
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
          {applied && (
            <>
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
                options={CERTIFICATE_STATUSES.map(([value, label]) => ({ value, label }))}
                value={draft.status}
                disabled={disabled}
                onChange={(status) => {
                  const choice = CERTIFICATE_STATUSES.find(([value]) => value === status);
                  if (choice) setDraft({ ...draft, status: choice[0] });
                }}
              />
            </>
          )}
          <FormActions>
            {applied && (
              <PageAction
                label="Clear"
                context="certificate filters"
                disabled={disabled}
                onClick={() => update({ classUuid: requested, ...UNFILTERED }, close)}
              />
            )}
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
    </FilterPopover>
  );
}
