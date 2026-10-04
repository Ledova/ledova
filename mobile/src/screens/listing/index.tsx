import { useState } from 'react';
import { Text, View, RefreshControl } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import * as Crypto from 'expo-crypto';
import { companyActivationOutcome, formatDate, useCompanyActivation } from '@ledova/shared';
import type { BottomTabParamList } from '../../navigation/BottomTabNavigator';
import { Action, Choice, Row, Rows, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { CustomModal } from '../../components/modal';
import { apiClient } from '../../services/apiClient';
import { useCompanyProfile } from '../../hooks/useCompanyProfile';
import { CompanyReadNotice } from '../company/CompanyState';
import { useCompanyStyles } from '../company-register/styles';
import { CompanySelection } from '../company/CompanySelection';

export function ListingScreen() {
  const read = useCompanyProfile({ personalOnly: true });
  return <ActivationDetails key={`${read.scopeKey}/${read.companyUuid ?? ''}`} read={read} />;
}

function ActivationDetails({ read }: { read: ReturnType<typeof useCompanyProfile> }) {
  const styles = useCompanyStyles();
  const navigation = useNavigation<NavigationProp<BottomTabParamList>>();
  const action = useCompanyActivation(apiClient, read, () => Crypto.randomUUID());
  const { company } = read;
  const events = company
    ? [
        ['Submitted', company.submittedAt],
        ['Review started', company.reviewStartedAt],
        ['Information requested', company.infoRequestedAt],
        ['Approved', company.approvedAt],
        ['Activated', company.activatedAt],
        ['Rejected', company.rejectionAt],
        ['Withdrawn', company.withdrawnAt],
      ]
        .flatMap(([label, at]) => (at ? [{ label: label!, at }] : []))
        .sort((a, b) => a.at.localeCompare(b.at))
    : [];
  return (
    <>
      <Page
        title="Activation"
        testID="activation-screen"
        actions={
          <Action
            label="Back to Company"
            onPress={() => navigation.navigate('Company', { screen: 'CompanyDetails' })}
          />
        }
        refreshControl={<RefreshControl refreshing={read.isRefreshing} onRefresh={() => void read.refetch()} />}
      >
        <CompanySelection read={read} />
        {action.busy && (
          <Text accessibilityRole="alert" style={styles.muted}>
            Checking activation…
          </Text>
        )}
        {read.isLoading ? (
          <Text style={styles.muted}>Loading company information…</Text>
        ) : read.error ? (
          <CompanyReadNotice read={read} />
        ) : !company ? (
          <Text style={styles.muted}>
            {read.companies.length
              ? 'Choose a company above.'
              : 'A current personal administrator appointment is required to activate a company.'}
          </Text>
        ) : (
          <>
            <Section title="Company activation">
              <Text style={styles.text}>{company.name}</Text>
              <Text style={styles.muted}>
                Company information is provided by the company. Activation records your declaration and the configured
                identity and ABR checks. It does not approve an offering, issue shares or approve a wallet.
              </Text>
              <Rows>
                <Row label="Status">{company.statusDisplay}</Row>
              </Rows>
              {company.status === 'active' && <Text style={styles.muted}>This company is active.</Text>}
              {action.latestAttempt && (
                <View style={styles.group}>
                  <Text style={styles.muted}>{companyActivationOutcome(action.latestAttempt)}</Text>
                  <Text style={styles.muted}>This attempt was recorded from your administrator appointment.</Text>
                </View>
              )}
              {action.canActivate && (
                <Action
                  label={action.latestAttempt ? 'Try activation again' : 'Review activation'}
                  primary
                  disabled={action.busy || read.isRefreshing}
                  onPress={() => void action.open()}
                />
              )}
            </Section>
            {events.length > 0 && (
              <Section title="Historical record">
                <Rows>
                  {events.map(({ label, at }) => (
                    <Row key={label} label={label}>
                      {formatDate(at)}
                    </Row>
                  ))}
                </Rows>
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
              </Section>
            )}
            <Action
              label="Company information and retained documents"
              onPress={() => navigation.navigate('Company', { screen: 'CompanyDetails' })}
            />
          </>
        )}
        {!!action.error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {action.error}
          </Text>
        )}
        <Section title={action.identityRequired ? 'Identity verification required' : 'Your identity'}>
          <Text style={styles.muted}>
            Use your own profile to complete the configured identity verification before activation.
          </Text>
          <Action label="Open your profile" onPress={() => navigation.navigate('Profile')} />
        </Section>
      </Page>
      {action.preview && <ActivationConfirmation action={action} />}
    </>
  );
}

function ActivationConfirmation({ action }: { action: ReturnType<typeof useCompanyActivation> }) {
  const styles = useCompanyStyles();
  const target = action.preview!;
  const [acceptance, setAcceptance] = useState<typeof action.preview>(null);
  const accepted = acceptance === target;
  return (
    <CustomModal
      visible
      title="Activate company"
      busy={action.busy}
      onClose={action.cancel}
      actions={
        <Action
          label="Confirm activation"
          primary
          disabled={!accepted || action.busy}
          onPress={() => {
            if (accepted) void action.confirm(target);
          }}
        />
      }
    >
      <Text style={styles.text}>{target.name}</Text>
      <Text style={styles.text}>{target.text}</Text>
      <Choice
        label="I accept this declaration for this company."
        selected={accepted}
        disabled={action.busy}
        onPress={() => setAcceptance(accepted ? null : target)}
      />
      <Text style={styles.muted}>
        The configured ABR lookup must match before activation can be applied. A failed or unavailable check remains in
        the record.
      </Text>
    </CustomModal>
  );
}
