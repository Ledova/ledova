import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import {
  FIELD_LIMITS,
  MEMBER_PARTICULARS_STATUS_LABELS,
  formatDate,
  useErrorSummary,
  type MemberParticularsRequest,
  type OwnMemberRecord,
} from '@ledova/shared';
import { Action, Actions, Choice, Fact, FormActions, Rows, Section, Status } from '../../components/Ledger';
import { Field } from '../../components/register/RegisterFields';
import { useThemedStyles } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { MemberNotice, RecordGate, useCompanyRecord, useMemberRecordsState } from '../holdings/MemberRecordsProvider';

function useDetailsStyles() {
  return useThemedStyles((theme) => ({
    columns: { gap: theme.spacing.lg },
    column: { gap: theme.spacing.smd },
    ruled: { paddingTop: theme.spacing.lg, borderTopWidth: 1, borderTopColor: theme.colors.border.subtle },
    heading: { fontFamily: theme.fontFamily.medium, fontSize: 14, lineHeight: 20, color: theme.colors.text.primary },
    toggle: { alignSelf: 'flex-start' as const },
    toggleText: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 20, color: theme.colors.brand.light },
    more: { gap: theme.spacing.smd },
    classLine: { paddingVertical: theme.spacing.sm },
    request: { paddingVertical: theme.spacing.md },
    first: { paddingTop: 0 },
    last: { paddingBottom: 0 },
    requestStatus: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      alignItems: 'center' as const,
      columnGap: theme.spacing.md,
      rowGap: theme.spacing.sm,
    },
    form: { gap: theme.spacing.md },
  }));
}

export function CompanyRecordedDetails({ opened }: { opened: string | undefined }) {
  const styles = useCompanyStyles();
  const navigation = useNavigation<NavigationProp<SignedInStackParamList>>();
  const { company, selectCompany } = useMemberRecordsState();
  const { read, record, selected } = useCompanyRecord(opened ?? company?.uuid ?? '');
  useEffect(() => {
    if (!opened || !record || !selectCompany(record.company.uuid)) return;
    navigation.setParams({ record: undefined });
  }, [opened, record, selectCompany, navigation]);
  if (!opened && !company && read.listReady && read.records.length === 0) return null;
  return (
    <Section title="Company-recorded details">
      <MemberNotice read={read} />
      {read.readFailed ? (
        <Actions>
          <Action label="Try again" disabled={read.busy} onPress={() => void read.refresh()} />
        </Actions>
      ) : !opened && !company && read.listReady ? (
        <Text style={styles.muted}>Loading member records…</Text>
      ) : (
        <RecordGate read={read} record={record} ready={!!selected}>
          {selected && <MemberParticulars key={selected.uuid} record={selected} />}
        </RecordGate>
      )}
    </Section>
  );
}

function MemberParticulars({ record }: { record: OwnMemberRecord }) {
  const styles = useCompanyStyles();
  const look = useDetailsStyles();
  const { read, draft, setDraft } = useMemberRecordsState();
  const { name, address, confirmed, open } = draft;
  const held = read.busy || !!read.retry;
  const checks = useErrorSummary({
    name: !name.trim() && 'Give the requested name.',
    address: !address.trim() && 'Give the requested residential address.',
    confirmed: !confirmed && 'Confirm sharing these particulars with the company.',
  });
  const requests = read.requests?.particulars ?? [];
  const pending = requests.filter((request) => request.status !== 'applied' && request.status !== 'rejected');
  const previous = requests.filter((request) => request.status === 'applied' || request.status === 'rejected');
  const unconfirmed = checks.field('confirmed').error;
  if (open)
    return (
      <View style={look.form}>
        <Text style={styles.muted}>The company reviews your request before updating its records.</Text>
        <Field
          label="Requested name"
          value={name}
          maxLength={FIELD_LIMITS.NAME}
          editable={!held}
          error={checks.field('name').error}
          onChange={(value) => setDraft((current) => ({ ...current, name: value, confirmed: false }))}
        />
        <Field
          label="Requested residential address"
          value={address}
          multiline
          maxLength={FIELD_LIMITS.RESIDENTIAL_ADDRESS}
          editable={!held}
          error={checks.field('address').error}
          onChange={(value) => setDraft((current) => ({ ...current, address: value, confirmed: false }))}
        />
        <View style={styles.group}>
          <Choice
            accessibilityRole="checkbox"
            selected={confirmed}
            disabled={held}
            label="Share these requested particulars with this company for review."
            onPress={() => setDraft((current) => ({ ...current, confirmed: !current.confirmed }))}
          />
          {!!unconfirmed && <Text style={styles.error}>{unconfirmed}</Text>}
        </View>
        <FormActions>
          <Action label="Cancel" disabled={held} onPress={() => setDraft((current) => ({ ...current, open: false }))} />
          <Action
            label={read.busy && read.retry?.kind === 'particulars' ? 'Sending request…' : 'Send request'}
            primary
            disabled={held}
            onPress={() => {
              if (checks.check()) void read.requestParticulars(name.trim(), address.trim());
            }}
          />
        </FormActions>
      </View>
    );
  return (
    <>
      <Text style={styles.muted}>
        Held by {record.company.name} in its register, separate from your personal information.
      </Text>
      <View style={look.columns}>
        <View style={look.column}>
          <Text accessibilityRole="header" style={look.heading}>
            Current details
          </Text>
          <Rows>
            <Fact label="Name">{record.name}</Fact>
            <Fact label="Residential address">{record.residentialAddress}</Fact>
          </Rows>
          <ShowMore show="Show ledger details" hide="Hide ledger details">
            <Text style={styles.muted}>
              Provided by the company, not verified by Ledova. Profile edits do not change this register.
            </Text>
            {record.classes.map((item) => (
              <Text key={item.uuid} style={[styles.muted, look.classLine]}>
                {item.name} · Entered {formatDate(item.enteredOn, 'Not recorded')}
                {item.ceasedOn ? ` · Ceased ${formatDate(item.ceasedOn)}` : ''} · Amount paid{' '}
                {item.amountPaid ?? 'not recorded'}
              </Text>
            ))}
          </ShowMore>
        </View>
        {(pending.length > 0 || previous.length > 0) && (
          <View style={[look.column, look.ruled]}>
            <Text accessibilityRole="header" style={look.heading}>
              Update requests
            </Text>
            {pending.length > 0 && <ParticularsRequests requests={pending} />}
            {previous.length > 0 && (
              <ShowMore show={`Show previous requests (${previous.length})`} hide="Hide previous requests">
                <ParticularsRequests requests={previous} />
              </ShowMore>
            )}
          </View>
        )}
      </View>
      <FormActions>
        <Action
          label="Request update"
          disabled={held}
          onPress={() => setDraft((current) => ({ ...current, open: true }))}
        />
      </FormActions>
    </>
  );
}

function ParticularsRequests({ requests }: { requests: MemberParticularsRequest[] }) {
  const styles = useCompanyStyles();
  const look = useDetailsStyles();
  return (
    <Rows>
      {requests.map((request, index) => (
        <View
          key={request.uuid}
          style={[look.request, index === 0 && look.first, index === requests.length - 1 && look.last]}
        >
          <Rows>
            <Fact label="Name">{request.name}</Fact>
            <Fact label="Residential address">{request.residentialAddress}</Fact>
            <Fact label="Status">
              <View style={look.requestStatus}>
                <Status
                  tone={request.status === 'applied' ? 'done' : request.status === 'rejected' ? 'closed' : 'waiting'}
                >
                  {MEMBER_PARTICULARS_STATUS_LABELS[request.status]}
                </Status>
                <Text style={styles.muted}>{formatDate(request.createdAt, 'Date not recorded')}</Text>
              </View>
            </Fact>
          </Rows>
        </View>
      ))}
    </Rows>
  );
}

function ShowMore({ show, hide, children }: { show: string; hide: string; children: ReactNode }) {
  const look = useDetailsStyles();
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        hitSlop={12}
        onPress={() => setOpen((shown) => !shown)}
        style={look.toggle}
      >
        <Text style={look.toggleText}>{open ? hide : show}</Text>
      </Pressable>
      {open && <View style={look.more}>{children}</View>}
    </View>
  );
}
