import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, Text, View, type ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { randomUUID } from 'expo-crypto';
import {
  COMPANY_STATUS_TONES,
  awaitsActivation,
  formatDate,
  useCompanyActivation,
  useCompanySelection,
  useErrorSummary,
} from '@ledova/shared';
import {
  Action,
  Fact,
  FormActions,
  LinkRow,
  LoadError,
  Loading,
  Rows,
  Section,
  ShowMore,
  Status,
  useCardStyles,
} from '../../components/Ledger';
import { CompanyContextNotice } from '../../components/CompanyContextNotice';
import { Page } from '../../components/Page';
import { Checkbox } from '../../components/register/RegisterFields';
import { useAppTheme, useMemberRecordsState, useThemedStyles } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { orderSubmissionSession } from '../../services/orderSubmissions';

type Read = ReturnType<typeof useCompanySelection>;
type Activation = ReturnType<typeof useCompanyActivation>;

function useActivationStyles() {
  return useThemedStyles((theme) => {
    const text = { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 20 };
    return {
      stack: { gap: theme.spacing.md },
      hidden: { display: 'none' as const },
      loading: { alignItems: 'center' as const, justifyContent: 'center' as const, paddingVertical: 80 },
      event: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: theme.spacing.smd,
        paddingVertical: theme.spacing.sm,
      },
      dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.brand.mid },
      label: { ...text, flex: 1, color: theme.colors.text.primary },
      date: { ...text, color: theme.colors.text.muted, fontVariant: ['tabular-nums' as const] },
    };
  });
}

export function ActivationScreen() {
  const { company: selected, companies, directory } = useMemberRecordsState();
  const read = useCompanySelection({
    personalOnly: true,
    selectedUuid: selected?.uuid ?? '',
    session: orderSubmissionSession,
  });
  return (
    <CompanyActivation
      key={`${read.scopeKey}/${read.companyUuid ?? ''}`}
      read={read}
      choosing={directory.isLoading || (!selected && companies.length > 0)}
    />
  );
}

function CompanyActivation({ read, choosing }: { read: Read; choosing: boolean }) {
  const theme = useAppTheme();
  const styles = useCompanyStyles();
  const look = useActivationStyles();
  const navigation = useNavigation<NativeStackNavigationProp<SignedInStackParamList>>();
  const action = useCompanyActivation(read, randomUUID);
  const { company } = read;
  const scroll = useRef<ScrollView>(null);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    if (action.preview) scroll.current?.scrollTo({ y: 0, animated: false });
  }, [action.preview]);
  const events = company
    ? (
        [
          ['Submitted', company.submittedAt],
          ['Review started', company.reviewStartedAt],
          ['Information requested', company.infoRequestedAt],
          ['Approved', company.approvedAt],
          ['Activated', company.activatedAt],
          ['Rejected', company.rejectionAt],
          ['Withdrawn', company.withdrawnAt],
        ] as const
      )
        .flatMap(([label, at]) => (at ? [{ label, at }] : []))
        .sort((a, b) => a.at.localeCompare(b.at))
    : [];
  return (
    <Page
      ref={scroll}
      testID="activation-scroll"
      title="Activation"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={theme.colors.interactive.active}
          onRefresh={() => {
            if (refreshing || action.busy || action.preview) return;
            setRefreshing(true);
            void read.refetch().finally(() => setRefreshing(false));
          }}
        />
      }
    >
      {read.isLoading || choosing ? (
        <View accessible accessibilityLabel="Loading" style={look.loading}>
          <ActivityIndicator size="large" color={theme.colors.interactive.active} />
        </View>
      ) : (
        <>
          <View style={[look.stack, !!action.preview && look.hidden]}>
            {action.busy && <Loading>Checking activation…</Loading>}
            {read.error ? (
              <LoadError retry={read.refetch} busy={read.isRefreshing}>
                Company information could not be loaded.
              </LoadError>
            ) : !company ? (
              <CompanyContextNotice />
            ) : (
              <Section title="Activation status">
                <Text style={styles.muted}>
                  Company information is provided by the company. Activation records your declaration and, where your
                  instance requires it, your verified identity. It does not issue shares or approve a wallet.
                </Text>
                <Rows>
                  <Fact label="Status">
                    <Status tone={COMPANY_STATUS_TONES.get(company.status) ?? 'closed'}>{company.statusDisplay}</Status>
                  </Fact>
                </Rows>
                {events.length > 0 && (
                  <ShowMore show="Show the historical record" hide="Hide the historical record">
                    <View>
                      {events.map((event) => (
                        <View key={`${event.label}-${event.at}`} style={look.event}>
                          <View style={look.dot} />
                          <Text style={look.label}>{event.label}</Text>
                          <Text style={look.date}>{formatDate(event.at)}</Text>
                        </View>
                      ))}
                    </View>
                    {!!company.rejectionReason && (
                      <Text style={styles.muted}>Rejection reason: {company.rejectionReason}</Text>
                    )}
                    {!!company.withdrawalReason && (
                      <Text style={styles.muted}>Withdrawal reason: {company.withdrawalReason}</Text>
                    )}
                    {!!company.infoRequestReason && (
                      <Text style={styles.muted}>Information requested: {company.infoRequestReason}</Text>
                    )}
                    {!!company.additionalInfoResponse && (
                      <Text style={styles.muted}>Previous response: {company.additionalInfoResponse}</Text>
                    )}
                  </ShowMore>
                )}
                {action.canActivate && (
                  <FormActions>
                    <Action
                      label="Review activation"
                      primary
                      disabled={action.busy || read.isRefreshing}
                      onPress={() => void action.open()}
                    />
                  </FormActions>
                )}
              </Section>
            )}
            {(!company || awaitsActivation(company)) && (
              <Section title="Your identity">
                <Text style={styles.muted}>
                  Use your own account to complete the configured identity verification before activation.
                </Text>
                <LinkRow label="Account" onPress={() => navigation.navigate('Account')} />
              </Section>
            )}
          </View>
          {action.preview && <ActivationConfirmation action={action} />}
          {!!action.error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {action.error}
            </Text>
          )}
        </>
      )}
    </Page>
  );
}

function ActivationConfirmation({ action }: { action: Activation }) {
  const styles = useCompanyStyles();
  const card = useCardStyles();
  const look = useActivationStyles();
  const target = action.preview!;
  const [acceptance, setAcceptance] = useState<Activation['preview']>(null);
  const accepted = acceptance === target;
  const declaration = useErrorSummary({ accepted: !accepted && 'Accept the declaration for this company.' });
  const acceptanceError = declaration.field('accepted').error;
  return (
    <View style={look.stack}>
      <Text accessibilityRole="header" style={card.title}>
        Review activation
      </Text>
      <Section title={target.name}>
        <Text style={styles.text}>{target.text}</Text>
        <View>
          <Checkbox
            label="I accept this declaration for this company."
            checked={accepted}
            disabled={action.busy}
            error={acceptanceError}
            onChange={(checked) => setAcceptance(checked ? target : null)}
          />
          {!!acceptanceError && <Text style={styles.error}>{acceptanceError}</Text>}
        </View>
      </Section>
      <FormActions>
        <Action label="Cancel" disabled={action.busy} onPress={action.cancel} />
        <Action
          label={action.busy ? 'Activating…' : 'Confirm activation'}
          primary
          disabled={action.busy}
          onPress={() => {
            if (!action.busy && declaration.check()) void action.confirm(target);
          }}
        />
      </FormActions>
    </View>
  );
}
