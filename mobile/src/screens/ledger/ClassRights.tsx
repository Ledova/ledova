import { Keyboard, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import {
  FIELD_LIMITS,
  RIGHTS_GROUPS,
  UPLOAD_RULE,
  classRightsTerms,
  formatDate,
  formatDateTime,
  isCalendarDate,
  preferenceMeasure,
  rightsAttributeProblems,
  rightsGroupValues,
  structuredRightsRows,
  useErrorSummary,
  utcToday,
  visibleRightsFields,
  type ClassRightsAttributes,
  type ClassRightsRevision,
  type FieldCheck,
  type useClassRights,
} from '@ledova/shared';
import {
  Action,
  Actions,
  Fact,
  FormActions,
  LoadError,
  Loading,
  Outcome,
  Rows,
  Section,
  ShowMore,
} from '../../components/Ledger';
import { Checkbox, Field, FileField } from '../../components/register/RegisterFields';
import { SelectField } from '../../components/SelectField';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { useLedgerStyles } from './useLedgerStyles';

type Rights = ReturnType<typeof useClassRights>;
type Editor = NonNullable<Rights['editor']>;

function RightsSummary({ revision, rights }: { revision: ClassRightsRevision; rights: Rights }) {
  const look = useLedgerStyles();
  const structured = Object.keys(revision.attributes).length > 0;
  const terms = classRightsTerms(revision.attributes, revision.summary);
  return (
    <View style={look.summary}>
      {structured && (
        <Rows>
          {structuredRightsRows(revision.attributes).map((row) => (
            <Fact key={row.label} label={row.label} inline>
              {row.value}
            </Fact>
          ))}
        </Rows>
      )}
      {!!terms && (
        <View style={look.terms}>
          <Text accessibilityRole="header" style={look.title}>
            Additional terms
          </Text>
          <Text style={look.text}>{terms}</Text>
        </View>
      )}
      {!structured && !terms && <Text style={look.muted}>No rights recorded.</Text>}
      {!!revision.effectiveDate && (
        <Rows>
          <Fact label="Effective date" inline>
            {formatDate(revision.effectiveDate)}
          </Fact>
        </Rows>
      )}
      {!!revision.documentReference && (
        <Rows>
          <Fact label="Earlier source note">{revision.documentReference}</Fact>
        </Rows>
      )}
      {revision.documents.length > 0 && (
        <View style={look.list}>
          <Text accessibilityRole="header" style={look.title}>
            Documents
          </Text>
          <Rows>
            {revision.documents.map((document) => {
              const label =
                rights.downloading === `${revision.uuid}/${document.evidence}` ? 'Downloading…' : 'Download';
              return (
                <View key={document.evidence} style={[look.row, look.line]}>
                  <Text style={[look.text, look.fill]}>{document.name}</Text>
                  <Action
                    label={label}
                    accessibilityLabel={`${label} (${document.name})`}
                    disabled={rights.busy}
                    onPress={() => void rights.download(revision, document)}
                  />
                </View>
              );
            })}
          </Rows>
        </View>
      )}
      <Text style={look.small}>
        Recorded by {revision.recordedByName || 'Company administrator'} · {formatDateTime(revision.createdAt)}
      </Text>
    </View>
  );
}

function StructuredRightsFields({
  attributes,
  onChange,
  disabled,
  field,
}: {
  attributes: ClassRightsAttributes;
  onChange: (attributes: ClassRightsAttributes) => void;
  disabled: boolean;
  field: (key: string) => FieldCheck;
}) {
  const look = useLedgerStyles();
  return (
    <View style={look.groups}>
      {RIGHTS_GROUPS.map((group) => {
        const values = rightsGroupValues(attributes, group.key);
        const change = (key: string, value: unknown) =>
          onChange({ ...attributes, [group.key]: { ...values, [key]: value } });
        return (
          <View key={group.key} accessibilityLabel={`${group.label} rights`} style={look.summary}>
            <SelectField
              label={group.label}
              options={group.options}
              value={String(values.type ?? 'not_recorded')}
              disabled={disabled}
              onChange={(type) => {
                const next = { ...attributes };
                if (type === 'not_recorded') delete next[group.key];
                else next[group.key] = { type } as never;
                onChange(next);
              }}
            />
            {group.measure && values.type === 'preferential' && (
              <SelectField
                label={group.measure.label}
                options={group.measure.options}
                value={preferenceMeasure(group, values)}
                disabled={disabled}
                onChange={(measure) => {
                  const next = { ...values };
                  for (const key of ['rate', 'multiple', 'amount', 'basis', 'currency']) delete next[key];
                  if (measure !== 'not_recorded') next[measure] = '';
                  onChange({ ...attributes, [group.key]: next });
                }}
              />
            )}
            {visibleRightsFields(group, values).map((definition) => {
              const check = field(`${group.key}.${definition.key}`);
              const value = values[definition.key];
              if (definition.kind === 'checkbox')
                return (
                  <Checkbox
                    key={definition.key}
                    label={definition.label}
                    checked={value === true}
                    disabled={disabled}
                    error={check.error}
                    onChange={(checked) => change(definition.key, checked ? true : undefined)}
                  />
                );
              if (definition.kind === 'select')
                return (
                  <SelectField
                    key={definition.key}
                    label={definition.label}
                    options={definition.options!}
                    value={String(value ?? 'not_recorded')}
                    disabled={disabled}
                    error={check.error}
                    onChange={(selected) => {
                      const next = { ...values, [definition.key]: selected };
                      if (selected === 'not_recorded') delete next[definition.key];
                      if (definition.key === 'participation' && selected !== 'capped') delete next.cap;
                      onChange({ ...attributes, [group.key]: next });
                    }}
                  />
                );
              return (
                <Field
                  key={definition.key}
                  label={definition.label}
                  hint={definition.hint}
                  value={String(value ?? '')}
                  keyboardType={definition.kind === 'decimal' ? 'decimal-pad' : undefined}
                  maxLength={
                    definition.key === 'currency'
                      ? 3
                      : definition.kind === 'decimal'
                        ? FIELD_LIMITS.CLASS_RIGHTS_DECIMAL
                        : FIELD_LIMITS.NAME
                  }
                  editable={!disabled}
                  error={check.error}
                  onChange={(text) => change(definition.key, definition.key === 'currency' ? text.toUpperCase() : text)}
                />
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

function RightsEditor({ rights }: { rights: Rights }) {
  const look = useLedgerStyles();
  const styles = useCompanyStyles();
  const editor = rights.editor!;
  const checks = useErrorSummary<string>({
    ...rightsAttributeProblems(editor.attributes),
    summary:
      Array.from(editor.summary).length > FIELD_LIMITS.CLASS_RIGHTS &&
      `Keep additional terms within ${FIELD_LIMITS.CLASS_RIGHTS} characters.`,
    effectiveDate:
      !!editor.effectiveDate &&
      (!isCalendarDate(editor.effectiveDate) || editor.effectiveDate > utcToday()) &&
      'Enter a complete effective date on or before today (UTC).',
  });
  const locked = rights.busy || rights.pending || rights.stale;
  const update = (change: (current: Editor) => Editor) => rights.setEditor((current) => current && change(current));
  return (
    <View style={look.fields}>
      <StructuredRightsFields
        attributes={editor.attributes}
        onChange={(attributes) => update((current) => ({ ...current, attributes }))}
        disabled={locked}
        field={checks.field}
      />
      <Field
        label="Additional terms"
        hint="Name the relevant right when describing a condition."
        value={editor.summary}
        multiline
        rows={5}
        maxLength={FIELD_LIMITS.CLASS_RIGHTS * 2}
        editable={!locked}
        error={checks.field('summary').error}
        onChange={(summary) => update((current) => ({ ...current, summary }))}
      />
      <Field
        label="Effective date"
        hint="Leave blank if unknown."
        value={editor.effectiveDate}
        placeholder="YYYY-MM-DD"
        keyboardType="numbers-and-punctuation"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!locked}
        error={checks.field('effectiveDate').error}
        onChange={(effectiveDate) => update((current) => ({ ...current, effectiveDate: effectiveDate.trim() }))}
      />
      <View style={look.group}>
        <View style={look.line}>
          <Text accessibilityRole="header" style={look.title}>
            Documents
          </Text>
          <Action
            label="Add document"
            disabled={locked || editor.documents.length >= 100}
            onPress={() =>
              update((current) => ({ ...current, documents: [...current.documents, { id: randomUUID(), file: null }] }))
            }
          />
        </View>
        {editor.documents.map((document, index) => (
          <View key={document.id} style={look.group}>
            {document.snapshot ? (
              <Text style={look.text}>{document.snapshot.name}</Text>
            ) : (
              <FileField
                label="File"
                value={document.file}
                hint={UPLOAD_RULE.HINT}
                disabled={locked}
                onFile={(file) =>
                  update((current) => ({
                    ...current,
                    documents: current.documents.map((row) => (row.id === document.id ? { ...row, file } : row)),
                  }))
                }
              />
            )}
            <Actions>
              <Action
                label="Remove"
                accessibilityLabel={`Remove (document ${index + 1})`}
                disabled={locked}
                onPress={() =>
                  update((current) => ({
                    ...current,
                    documents: current.documents.filter((row) => row.id !== document.id),
                  }))
                }
              />
            </Actions>
          </View>
        ))}
      </View>
      {rights.stale && !rights.pending && (
        <Text accessibilityRole="alert" style={styles.error}>
          The class rights or your administrator access changed. Close this form and reopen the current details.
        </Text>
      )}
      {!!rights.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {rights.error}
        </Text>
      )}
      <FormActions>
        <Action
          label="Cancel"
          disabled={rights.busy || rights.pending}
          onPress={() => {
            Keyboard.dismiss();
            rights.close();
          }}
        />
        <Action
          primary
          label={rights.busy ? 'Saving…' : rights.pending ? 'Retry original save' : 'Save'}
          disabled={rights.busy || (rights.stale && !rights.pending)}
          onPress={() => {
            if (!checks.check()) return;
            Keyboard.dismiss();
            void rights.save();
          }}
        />
      </FormActions>
    </View>
  );
}

export function ClassRights({ rights }: { rights: Rights }) {
  const look = useLedgerStyles();
  const styles = useCompanyStyles();
  if (!rights.tokenReady) return null;
  const { query } = rights;
  return (
    <Section title="Class rights">
      {rights.hasError ? (
        <LoadError retry={rights.retry} busy={rights.isRefreshing}>
          The class rights could not be loaded. They may be unavailable to this account.
        </LoadError>
      ) : !rights.ready ? (
        <Loading>Loading class rights…</Loading>
      ) : (
        <>
          <Text style={look.muted}>Company-recorded terms. The governing documents determine the rights.</Text>
          {rights.editor ? (
            <RightsEditor rights={rights} />
          ) : rights.current ? (
            <RightsSummary revision={rights.current} rights={rights} />
          ) : (
            <Text style={look.muted}>No rights recorded.</Text>
          )}
          {(rights.appointment || rights.pending) && !rights.editor && (
            <Action
              label="Edit"
              accessibilityLabel="Edit (Class rights)"
              disabled={rights.busy}
              onPress={() => {
                try {
                  rights.open();
                } catch {
                  return;
                }
              }}
            />
          )}
          {!!rights.outcome && <Outcome>{rights.outcome}</Outcome>}
          {!rights.editor && !!rights.error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {rights.error}
            </Text>
          )}
          {!rights.editor && rights.count > 1 && (
            <ShowMore show={`Show previous versions (${rights.count - 1})`} hide="Hide previous versions">
              <Rows>
                {rights.revisions
                  .filter((revision) => revision.uuid !== rights.current?.uuid)
                  .map((revision) => (
                    <View key={revision.uuid} style={look.row}>
                      <Text style={look.title}>Version {revision.revision}</Text>
                      <RightsSummary revision={revision} rights={rights} />
                    </View>
                  ))}
              </Rows>
              {query.isFetchNextPageError ? (
                <LoadError retry={() => query.fetchNextPage()} busy={query.isFetching}>
                  More versions could not be loaded. The list is incomplete.
                </LoadError>
              ) : query.hasNextPage ? (
                <Action
                  label={query.isFetchingNextPage ? 'Loading versions…' : 'Load more versions'}
                  disabled={query.isFetching}
                  onPress={() => void query.fetchNextPage()}
                />
              ) : null}
            </ShowMore>
          )}
        </>
      )}
    </Section>
  );
}
