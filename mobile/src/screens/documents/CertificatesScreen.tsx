import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useNavigation, type NavigationProp, type RouteProp } from '@react-navigation/native';
import {
  REGISTER_CORRECTION_COPY,
  formatDate,
  shareChange,
  type OwnMemberRecord,
  type RegisterEntryKind,
  type useMemberRecords,
} from '@ledova/shared';
import { SelectField } from '../../components/SelectField';
import { FilterPopover } from '../../components/FilterPopover';
import { Action, Actions, FormActions, Rows, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { useThemedStyles } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import {
  MemberNotice,
  RecordGate,
  useCompanyRecord,
  useMemberRecordsState,
  useMemberRefresh,
} from '../holdings/MemberRecordsProvider';

type Entry = ReturnType<typeof useMemberRecords>['entries'][number];

const companyDated = (entry: Entry) => ['issue', 'transfer'].includes(entry.kind.toLowerCase());

function useCertificateStyles() {
  return useThemedStyles((theme) => {
    const text = { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 20 };
    return {
      row: { gap: 12, paddingVertical: theme.spacing.md },
      change: { gap: theme.spacing.xs },
      line: { flexDirection: 'row' as const, gap: theme.spacing.md },
      name: { ...text, flex: 2, fontFamily: theme.fontFamily.medium, color: theme.colors.text.primary },
      shares: { ...text, flex: 1, textAlign: 'right' as const, color: theme.colors.text.primary },
      muted: { ...text, color: theme.colors.text.muted },
    };
  });
}

export function CertificatesScreen({ route }: { route: RouteProp<SignedInStackParamList, 'Certificates'> }) {
  const styles = useCompanyStyles();
  const look = useCertificateStyles();
  const navigation = useNavigation<NavigationProp<SignedInStackParamList>>();
  const { company, selectCompany } = useMemberRecordsState();
  const opened = route.params?.record;
  const openedToken = route.params?.token;
  const [chosen, setChosen] = useState<string | null>(openedToken ?? null);
  const { read, record, selected, focused } = useCompanyRecord(opened ?? company?.uuid ?? '');
  useEffect(() => {
    if (!opened || !record || !selectCompany(record.company.uuid)) return;
    setChosen(openedToken ?? null);
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
                  setChosen(next);
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
      ) : !opened && !company ? (
        read.listReady ? (
          !read.error && <Text style={styles.muted}>Choose a company on Dashboard.</Text>
        ) : (
          <Text style={styles.muted}>Loading certificate records…</Text>
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
                  const kind =
                    REGISTER_CORRECTION_COPY.ENTRY_KINDS[entry.kind.toLowerCase() as RegisterEntryKind] ??
                    'Register change';
                  return (
                    <View key={`${token}/${entry.uuid}`} style={look.row}>
                      <View style={look.change}>
                        <View style={look.line}>
                          <Text style={look.name}>{selected?.name ?? 'Shareholder'}</Text>
                          <Text style={look.shares}>
                            {shareChange(entry.delta)} {item?.symbol} shares
                          </Text>
                        </View>
                        <Text style={look.muted}>
                          {kind} · {item?.symbol} · entry {entry.sequence}
                        </Text>
                      </View>
                      <View>
                        <Text style={look.muted}>
                          {companyDated(entry)
                            ? formatDate(entry.companyEventOn, 'Not recorded')
                            : formatDate(entry.effectiveOn)}
                        </Text>
                        {companyDated(entry) && entry.effectiveOn !== entry.companyEventOn && (
                          <Text style={look.muted}>Ledger date {formatDate(entry.effectiveOn)}</Text>
                        )}
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
