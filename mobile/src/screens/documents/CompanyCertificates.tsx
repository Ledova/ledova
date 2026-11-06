import { useCallback, useState } from 'react';
import { Keyboard, RefreshControl, Text, View } from 'react-native';
import {
  CERTIFICATE_NONE_DUE,
  CERTIFICATE_STATUSES,
  certificateFacts,
  certificateStatus,
  isCertificateEntry,
  shareChange,
  useCompanyCertificates,
  type CertificateFilterValues,
  type CompanyShareTokenListItem,
  type OrderSubmissionOwner,
  type RegisterEntry,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { FilterPopover } from '../../components/FilterPopover';
import { Action, FormActions, LoadError, LoadMore, Loading, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { Field } from '../../components/register/RegisterFields';
import { SelectField } from '../../components/SelectField';
import { useAppTheme } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { ClassCertificate } from './ClassCertificate';
import { useDocumentStyles } from './useDocumentStyles';

type CertificateClass = Pick<CompanyShareTokenListItem, 'uuid' | 'name' | 'symbol'>;
type Source = {
  owner: OrderSubmissionOwner;
  register: TokenHoldersResponse;
  entries: RegisterEntry[];
  guard: () => void;
  sourceReady: boolean;
  readReady: boolean;
  more: { hasMore: boolean; failed: boolean; loading: boolean; onLoad: () => unknown };
};

const UNFILTERED: CertificateFilterValues = { search: '', status: 'all' };

export function CompanyCertificates({
  owner,
  currentOwner,
  company,
  chosen,
  onChoose,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  company: string;
  chosen: string | null;
  onChoose: (token: string) => void;
}) {
  const theme = useAppTheme();
  const styles = useCompanyStyles();
  const [filters, setFilters] = useState(UNFILTERED);
  const [editing, setEditing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const source = useCompanyCertificates(owner, currentOwner, company, chosen, filters, orderSubmissionSession);
  const selected = source.options.find((item) => item.uuid === source.token);
  const retry = () => source.retry().catch(() => undefined);
  return (
    <Page
      testID="certificates-scroll"
      title="Certificates"
      titleAction={
        <CertificateFilters
          classes={source.options}
          selected={selected}
          chosen={chosen}
          applied={filters}
          disabled={editing}
          onApply={(token, values) => {
            onChoose(token);
            setFilters(values);
          }}
        />
      }
      refreshControl={
        <RefreshControl
          testID="certificates-refresh"
          refreshing={refreshing}
          tintColor={theme.colors.interactive.active}
          onRefresh={() => {
            if (refreshing || editing) return;
            setRefreshing(true);
            void retry().finally(() => setRefreshing(false));
          }}
        />
      }
    >
      <Section title="Certificate records">
        {source.hasError ? (
          <LoadError retry={retry} busy={source.isRefreshing}>
            Certificate records could not be loaded.
          </LoadError>
        ) : !source.sourceReady ? (
          <Loading>Loading certificate records…</Loading>
        ) : chosen && !selected ? (
          <Text style={styles.muted}>This share class is unavailable for the selected company.</Text>
        ) : selected && !source.ready ? (
          <Loading>Loading certificate records…</Loading>
        ) : (
          <CertificateRecords
            key={JSON.stringify([company, selected?.uuid, filters])}
            onEditingChange={setEditing}
            selectedClass={selected}
            filters={filters}
            source={
              source.register && selected
                ? {
                    owner,
                    register: source.register,
                    entries: source.entries,
                    guard: source.guard,
                    sourceReady: source.ready && !source.more.failed && !source.more.loading,
                    readReady: source.ready,
                    more: source.more,
                  }
                : undefined
            }
          />
        )}
      </Section>
    </Page>
  );
}

function CertificateRecords({
  selectedClass,
  onEditingChange,
  source,
  filters,
}: {
  selectedClass?: CertificateClass;
  onEditingChange: (open: boolean) => void;
  source?: Source;
  filters: CertificateFilterValues;
}) {
  const look = useDocumentStyles();
  const [editing, setEditing] = useState<string | null>(null);
  const editingChange = useCallback(
    (uuid: string, open: boolean) => {
      setEditing((current) => (open ? uuid : current === uuid ? null : current));
      onEditingChange(open);
    },
    [onEditingChange],
  );
  const records = (source?.entries ?? [])
    .filter(isCertificateEntry)
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  const filtered = !!filters.search || filters.status !== 'all';
  return (
    <>
      {filtered && records.length === 0 && (
        <Text accessibilityLiveRegion="polite" style={look.muted}>
          No certificate records match these filters.
        </Text>
      )}
      {records.length === 0 && !filtered && (
        <Text style={look.muted}>
          {source
            ? 'No eligible certificate records in the loaded entries.'
            : selectedClass
              ? 'No register entries for this class yet.'
              : 'No register entries yet.'}
        </Text>
      )}
      {source && records.length > 0 && (
        <View>
          {records.map((entry, index) => {
            const facts = certificateFacts(entry, selectedClass?.symbol);
            return (
              <View
                key={`${selectedClass?.uuid}/${entry.uuid}`}
                style={[
                  look.record,
                  index > 0 && !editing && look.divided,
                  !!editing && editing !== entry.uuid && look.hidden,
                ]}
              >
                <View style={look.change}>
                  {entry.changes.map((change) => (
                    <View key={change.member} style={look.line}>
                      <Text style={look.name}>{change.name ?? 'Shareholder'}</Text>
                      <Text style={look.shares}>
                        {shareChange(change.shares)} {selectedClass?.symbol} shares
                      </Text>
                    </View>
                  ))}
                  <Text style={look.small}>{`${facts.entry} · ${facts.dates}`}</Text>
                </View>
                {certificateStatus(entry) === 'reversed' && (
                  <Text style={look.small}>Certificate: {CERTIFICATE_NONE_DUE}</Text>
                )}
                <ClassCertificate
                  sourceKey={`${source.owner.userUuid}/${source.owner.ownerAccountUuid}`}
                  register={source.register}
                  entry={entry}
                  guard={source.guard}
                  sourceReady={source.sourceReady}
                  onEditingChange={editingChange}
                />
              </View>
            );
          })}
        </View>
      )}
      {source && !editing && <LoadMore noun="register entries" {...source.more} disabled={!source.readReady} />}
    </>
  );
}

function CertificateFilters({
  classes,
  selected,
  chosen,
  applied,
  disabled,
  onApply,
}: {
  classes: CertificateClass[];
  selected?: CertificateClass;
  chosen: string | null;
  applied: CertificateFilterValues;
  disabled: boolean;
  onApply: (token: string, values: CertificateFilterValues) => void;
}) {
  const requested = chosen ?? selected?.uuid ?? '';
  const version = JSON.stringify([requested, applied.search, applied.status]);
  const [seen, setSeen] = useState(version);
  const [draft, setDraft] = useState({ ...applied, classUuid: requested });
  if (seen !== version) {
    setSeen(version);
    setDraft({ ...applied, classUuid: requested });
  }
  const update = (values: typeof draft, close: () => void) => {
    if (disabled) return;
    const search = values.search.trim();
    setDraft({ ...values, search });
    Keyboard.dismiss();
    close();
    onApply(values.classUuid, { search, status: values.status });
  };
  return (
    <FilterPopover active={!!applied.search || applied.status !== 'all'}>
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
          <Field
            label="Shareholder"
            value={draft.search}
            maxLength={100}
            editable={!disabled}
            autoCorrect={false}
            clearable
            onChange={(search) => setDraft({ ...draft, search })}
          />
          <SelectField
            label="Certificate status"
            value={draft.status}
            options={CERTIFICATE_STATUSES.map(([value, label]) => ({ value, label }))}
            disabled={disabled}
            onChange={(status) => setDraft({ ...draft, status })}
          />
          <FormActions>
            <Action
              label="Clear"
              accessibilityLabel="Clear (certificate filters)"
              disabled={disabled}
              onPress={() => update({ classUuid: requested, ...UNFILTERED }, close)}
            />
            <Action
              label="Apply"
              accessibilityLabel="Apply (certificate filters)"
              primary
              disabled={disabled || !classes.some((item) => item.uuid === draft.classUuid)}
              onPress={() => update(draft, close)}
            />
          </FormActions>
        </>
      )}
    </FilterPopover>
  );
}
