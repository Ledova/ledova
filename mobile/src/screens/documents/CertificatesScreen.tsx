import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useNavigation, type NavigationProp, type RouteProp } from '@react-navigation/native';
import { certificateFacts, shareChange, useSubmissionOwner, type OwnMemberRecord } from '@ledova/shared';
import { SelectField } from '../../components/SelectField';
import { FilterPopover } from '../../components/FilterPopover';
import { Action, Actions, FormActions, LoadError, Loading, Rows, Section } from '../../components/Ledger';
import { MemberNotice, RecordGate, useMemberRefresh } from '../../components/MemberRecords';
import { Page } from '../../components/Page';
import { useCompanyRecord, useMemberRecordsState } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { CompanyCertificates } from './CompanyCertificates';
import { useDocumentStyles } from './useDocumentStyles';

type Route = RouteProp<SignedInStackParamList, 'Certificates'>;

export function CertificatesScreen({ route }: { route: Route }) {
  const { owner, boundary } = useSubmissionOwner(orderSubmissionSession);
  const { directory, company } = useMemberRecordsState();
  const [chosen, setChosen] = useState<string | null>(route.params?.token ?? null);
  if (route.params?.record || !company?.canReadRegister || directory.hasError)
    return <MemberCertificates route={route} chosen={chosen} onChoose={setChosen} />;
  if (!owner)
    return (
      <Page testID="certificates-scroll" title="Certificates">
        <Loading>Loading certificate records…</Loading>
      </Page>
    );
  return (
    <CompanyCertificates
      key={`${owner.userUuid}/${owner.ownerAccountUuid}/${orderSubmissionSession.getEpoch()}/${company.uuid}`}
      owner={owner}
      currentOwner={boundary.get}
      company={company.uuid}
      chosen={chosen}
      onChoose={setChosen}
    />
  );
}

function MemberCertificates({
  route,
  chosen,
  onChoose,
}: {
  route: Route;
  chosen: string | null;
  onChoose: (token: string | null) => void;
}) {
  const styles = useCompanyStyles();
  const look = useDocumentStyles();
  const navigation = useNavigation<NavigationProp<SignedInStackParamList>>();
  const { directory, company, member, selectCompany } = useMemberRecordsState();
  const opened = route.params?.record;
  const openedToken = route.params?.token;
  const { read, record, selected, focused } = useCompanyRecord(opened ?? member?.uuid ?? '');
  useEffect(() => {
    if (!opened || !record || !selectCompany(record.company.uuid)) return;
    onChoose(openedToken ?? null);
    navigation.setParams({ record: undefined, token: undefined });
  }, [opened, openedToken, record, selectCompany, navigation]);
  const refresh = useMemberRefresh(read, 'certificates-refresh');
  const shown = selected ?? record;
  const classes = shown?.classes ?? [];
  const token = chosen ?? classes[0]?.uuid ?? null;
  const item = classes.find((row) => row.uuid === token);
  const { selectToken, selectedToken } = read;
  useEffect(() => {
    if (focused && selected && item && !read.busy && !read.retry && selectedToken !== item.uuid) selectToken(item.uuid);
  }, [focused, selected, item, read.busy, read.retry, selectedToken, selectToken]);
  const held = read.busy || !!read.retry;
  const unknownClass = !!selected && !!chosen && !item;
  const own = !!item && selectedToken === item.uuid && read.entriesReady;
  const listed = !!selected && !unknownClass && (classes.length === 0 || own);
  const rows = [...(own ? read.entries : [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <Page
      testID="certificates-scroll"
      title="Certificates"
      titleAction={
        classes.length > 1 ? (
          <FilterPopover>
            {(close) => (
              <FilterFields
                record={shown}
                applied={token}
                disabled={held}
                onApply={(next) => {
                  onChoose(next);
                  close();
                }}
              />
            )}
          </FilterPopover>
        ) : undefined
      }
      refreshControl={refresh}
    >
      <MemberNotice read={read} />
      {read.readFailed ? (
        <Actions>
          <Action label="Try again" disabled={read.busy} onPress={() => void read.refresh()} />
        </Actions>
      ) : !opened && directory.hasError ? (
        <LoadError retry={directory.retry} busy={directory.isRefreshing}>
          Your company access could not be confirmed.
        </LoadError>
      ) : !opened && !member ? (
        !read.listReady || directory.isLoading || (directory.companies.length > 0 && !company) ? (
          <Text style={styles.muted}>Loading certificate records…</Text>
        ) : (
          !read.error && (
            <Text style={styles.muted}>
              {company ? 'Your account has no certificate access for this company.' : 'Choose a company on Dashboard.'}
            </Text>
          )
        )
      ) : (
        <RecordGate read={read} record={record} ready={!!selected}>
          <Section title="Certificate records">
            {unknownClass ? (
              <Text style={look.muted}>Your account has no member record for this share class.</Text>
            ) : !listed ? (
              <Text style={look.muted}>Loading your certificate records…</Text>
            ) : rows.length === 0 ? (
              <Text style={look.muted}>
                {item ? 'No register entries for this class yet.' : 'No register entries yet.'}
              </Text>
            ) : (
              <Rows>
                {rows.map((entry) => {
                  const facts = certificateFacts(entry, item?.symbol);
                  return (
                    <View key={`${token}/${entry.uuid}`} style={look.record}>
                      <View style={look.change}>
                        <View style={look.line}>
                          <Text style={look.name}>{selected?.name ?? 'Shareholder'}</Text>
                          <Text style={look.shares}>
                            {shareChange(entry.delta)} {item?.symbol} shares
                          </Text>
                        </View>
                        <Text style={look.small}>{`${facts.entry} · ${facts.date}`}</Text>
                      </View>
                    </View>
                  );
                })}
              </Rows>
            )}
          </Section>
        </RecordGate>
      )}
    </Page>
  );
}

function FilterFields({
  record,
  applied,
  disabled,
  onApply,
}: {
  record: OwnMemberRecord | undefined;
  applied: string | null;
  disabled: boolean;
  onApply: (token: string) => void;
}) {
  const [draft, setDraft] = useState(applied);
  const classes = record?.classes ?? [];
  const valid = classes.some((row) => row.uuid === draft);
  return (
    <>
      <SelectField
        label="Share class"
        value={draft ?? ''}
        options={classes.map((row) => ({ value: row.uuid, label: `${row.name} · ${row.symbol}` }))}
        disabled={disabled}
        onChange={setDraft}
      />
      <FormActions>
        <Action
          label="Apply"
          accessibilityLabel="Apply (certificate filters)"
          primary
          disabled={disabled || !valid}
          onPress={() => draft && onApply(draft)}
        />
      </FormActions>
    </>
  );
}
