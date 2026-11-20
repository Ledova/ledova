import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useNavigation, usePreventRemove } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import {
  COMPANY_EDIT_FIELDS,
  REGISTER_QUERY_KEY,
  failureSentence,
  ownCompaniesKey,
  readApiError,
  useCompanyDeletion,
  useCompanySelection,
  useEditCompanyForm,
  type Company,
  type EditCompanyFormProps,
} from '@ledova/shared';
import { Checkbox, Field } from '../../components/Field';
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
} from '../../components/Ledger';
import { CustomModal } from '../../components/modal';
import { useMemberRecordsState, useThemedStyles } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';

export function CompanyProfile() {
  const { company: selected } = useMemberRecordsState();
  const [draft, setEditing] = useState<Company | null>(null);
  const switched = !!draft && !!selected && draft.uuid !== selected.uuid;
  const editing = switched ? null : draft;
  useEffect(() => {
    if (switched) setEditing(null);
  }, [switched]);
  if (!selected?.canManage && !editing) return null;
  return <SelectedCompany selected={editing?.uuid ?? selected?.uuid ?? ''} editing={editing} setEditing={setEditing} />;
}

function SelectedCompany({
  selected,
  editing,
  setEditing,
}: {
  selected: string;
  editing: Company | null;
  setEditing: (company: Company | null) => void;
}) {
  const data = useCompanySelection({ selectedUuid: selected, session: orderSubmissionSession });
  return (
    <CompanyDetails
      key={`${data.scopeKey}/${data.companyUuid ?? ''}`}
      data={data}
      editing={editing}
      setEditing={setEditing}
    />
  );
}

function CompanyDetails({
  data,
  editing,
  setEditing,
}: {
  data: ReturnType<typeof useCompanySelection>;
  editing: Company | null;
  setEditing: (company: Company | null) => void;
}) {
  const styles = useCompanyStyles();
  const client = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { company } = data;
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: data.companyKey, exact: true }),
      client.invalidateQueries({ queryKey: ownCompaniesKey(data.owner) }),
      client.invalidateQueries({ queryKey: REGISTER_QUERY_KEY }),
      client.invalidateQueries({ queryKey: ['member-records'] }),
    ]);
  const street = company
    ? [
        company.addressLine1,
        company.addressLine2,
        [company.city, company.state, company.postcode].filter(Boolean).join(' '),
      ].filter(Boolean)
    : [];
  const address = street.length ? [...street, company?.country].filter(Boolean).join(', ') : '';
  return (
    <Section title="Company details">
      {data.isLoading ? (
        <Loading>Loading company details…</Loading>
      ) : editing ? (
        <EditCompanyForm
          key={`${data.scopeKey}/${editing.uuid}`}
          target={editing}
          canShareOwnership={data.canPersonalAdmin}
          company={company}
          read={data}
          onClose={() => setEditing(null)}
          onSuccess={async () => {
            await refresh();
            setSaved(true);
          }}
        />
      ) : data.error ? (
        <LoadError retry={data.refetch} busy={data.isRefreshing}>
          Company information could not be loaded.
        </LoadError>
      ) : !company ? (
        <Text style={styles.muted}>The selected company is unavailable for this page.</Text>
      ) : (
        <>
          <Rows>
            <Fact label="Company name" inline>
              {company.name}
            </Fact>
            <Fact label="Status" inline>
              {company.statusDisplay}
            </Fact>
            {!!company.tradingName && (
              <Fact label="Trading name" inline>
                {company.tradingName}
              </Fact>
            )}
            <Fact label="Type" inline>
              {company.companyTypeDisplay}
            </Fact>
            <Fact label="ACN" inline>
              {company.acn}
            </Fact>
            <Fact label="Ownership overview" inline>
              {company.shareOwnershipWithMembers ? 'Shared with members' : 'Not shared'}
            </Fact>
            {!!company.abn && (
              <Fact label="ABN" inline>
                {company.abn}
              </Fact>
            )}
            {data.canAdmin && !!company.email && (
              <Fact label="Email" inline>
                {company.email}
              </Fact>
            )}
            {!!company.phone && (
              <Fact label="Phone" inline>
                {company.phone}
              </Fact>
            )}
            {!!address && (
              <Fact label="Address" inline>
                {address}
              </Fact>
            )}
          </Rows>
          <Text style={styles.muted}>Company information is provided by the company.</Text>
          {data.isRefreshing && <Text style={styles.muted}>Refreshing company information…</Text>}
          {saved && <Outcome>Company details were saved.</Outcome>}
          {data.canAdmin && (
            <Actions>
              <Action
                compact
                label="Edit"
                accessibilityLabel="Edit (company)"
                disabled={data.isRefreshing}
                onPress={() => {
                  setSaved(false);
                  setEditing(company);
                }}
              />
              <Action
                compact
                destructive
                label="Delete"
                accessibilityLabel="Delete (company)"
                disabled={data.isRefreshing}
                onPress={() => setDeleting(true)}
              />
            </Actions>
          )}
          {deleting && <DeleteCompany company={company} data={data} onClose={() => setDeleting(false)} />}
        </>
      )}
    </Section>
  );
}

function DeleteCompany({
  company,
  data,
  onClose,
}: {
  company: Company;
  data: ReturnType<typeof useCompanySelection>;
  onClose: () => void;
}) {
  const styles = useCompanyStyles();
  const navigation = useNavigation<NativeStackNavigationProp<SignedInStackParamList>>();
  const removal = useCompanyDeletion({ company, read: data, onDeleted: () => navigation.popTo('Dashboard') });
  return (
    <CustomModal
      visible
      title={`Delete ${company.name}?`}
      busy={removal.isPending}
      onClose={onClose}
      actions={
        <Action
          label={removal.isPending ? 'Deleting…' : 'Delete'}
          accessibilityLabel={`${removal.isPending ? 'Deleting…' : 'Delete'} (company)`}
          destructive
          disabled={removal.isPending}
          onPress={() => removal.mutate()}
        />
      }
    >
      <Text style={styles.text}>This deletes the company and all its records for everyone. This can’t be undone.</Text>
      {removal.isError && (
        <Text accessibilityRole="alert" style={styles.error}>
          {failureSentence(removal.error, 'The company was not deleted. Try again.')}
        </Text>
      )}
    </CustomModal>
  );
}

function EditCompanyForm(props: EditCompanyFormProps) {
  const styles = useCompanyStyles();
  const look = useThemedStyles((theme) => ({ form: { gap: theme.spacing.md } }));
  const { company, target, read, onClose, draft, setDraft, pendingRef, available, problems, save } =
    useEditCompanyForm(props);
  const [checked, setChecked] = useState(false);
  usePreventRemove(save.isPending, () => {});
  const reading = save.isError
    ? readApiError(save.error, {
        fallback: 'Company changes could not be saved. Try again.',
        unanswered: 'The company changes could not be confirmed. Refresh before retrying.',
        displayedFields: [...COMPANY_EDIT_FIELDS.map(([key]) => key), 'shareOwnershipWithMembers'],
      })
    : null;
  return (
    <View style={look.form}>
      {!!read.error && (
        <LoadError retry={read.refetch} busy={read.isRefreshing}>
          Company information could not be loaded.
        </LoadError>
      )}
      {!read.error && read.isRefreshing && <Text style={styles.muted}>Refreshing company information…</Text>}
      {company?.uuid !== target.uuid && (
        <Text accessibilityRole="alert" style={styles.muted}>
          This draft belongs to a company that is no longer selected.
        </Text>
      )}
      {reading && (
        <Text accessibilityRole="alert" style={styles.error}>
          {reading.generalError ?? 'The company changes were not saved. Check the fields below.'}
        </Text>
      )}
      {COMPANY_EDIT_FIELDS.map(([key, label, maxLength]) => (
        <Field
          key={key}
          label={label}
          value={draft[key]}
          maxLength={maxLength}
          keyboardType={key === 'phone' ? 'phone-pad' : undefined}
          editable={!save.isPending}
          error={(checked && problems[key]) || reading?.fieldErrors?.[key]?.join(' ') || null}
          onChange={(value) => setDraft({ ...draft, [key]: value })}
        />
      ))}
      {props.canShareOwnership && (
        <>
          <Checkbox
            label="Share ownership overview with members"
            checked={draft.shareOwnershipWithMembers}
            disabled={save.isPending}
            error={reading?.fieldErrors?.shareOwnershipWithMembers?.join(' ') ?? null}
            onChange={(shareOwnershipWithMembers) => setDraft({ ...draft, shareOwnershipWithMembers })}
          />
          <Text style={styles.muted}>
            Linked members can see company and share-class totals alongside their own holding. Other shareholders’
            records stay private.
          </Text>
        </>
      )}
      <FormActions>
        <Action
          label="Cancel"
          accessibilityLabel="Cancel (company details)"
          disabled={save.isPending}
          onPress={onClose}
        />
        <Action
          label={save.isPending ? 'Saving…' : 'Save'}
          accessibilityLabel={`${save.isPending ? 'Saving…' : 'Save'} (company)`}
          primary
          disabled={!available || save.isPending}
          onPress={() => {
            setChecked(true);
            if (!available || Object.values(problems).some(Boolean) || pendingRef.current) return;
            pendingRef.current = true;
            save.mutate();
          }}
        />
      </FormActions>
    </View>
  );
}
