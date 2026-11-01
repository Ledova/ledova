import { useState } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import {
  CATEGORIES,
  failureSentence,
  formatDate,
  investorClaimState,
  useDocuments,
  useRefreshDocuments,
  useInvestorEligibility,
  useInvestorWithdrawal,
  type InvestorCategory,
  type InvestorClassification,
} from '@ledova/shared';
import { Action, Actions, Fact, Rows, Section, Status } from '../../components/Ledger';
import { CustomModal } from '../../components/modal';
import { Page } from '../../components/Page';
import { useAppTheme, useThemedStyles } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { ClaimModal } from './ClaimModal';
import { DocumentsPanel } from './DocumentsPanel';

export function VerificationScreen() {
  const theme = useAppTheme();
  const styles = useCompanyStyles();
  const look = useThemedStyles((theme) => ({
    state: { gap: theme.spacing.smd },
    record: { paddingVertical: theme.spacing.md },
    top: { gap: theme.spacing.smd },
    heading: { gap: theme.spacing.xs },
    reason: { paddingTop: theme.spacing.sm },
    name: { fontFamily: theme.fontFamily.medium, fontSize: 14, lineHeight: 20, color: theme.colors.text.primary },
    section: { fontFamily: theme.fontFamily.regular, fontSize: 12, lineHeight: 16, color: theme.colors.text.muted },
  }));
  const { classifications, isLoading, hasError, isRefreshing, retry, refresh } = useInvestorEligibility();
  const [claimCategory, setClaimCategory] = useState<InvestorCategory | null>(null);
  const withdraw = useInvestorWithdrawal(refresh, orderSubmissionSession);
  const [withdrawing, setWithdrawing] = useState<InvestorClassification | null>(null);
  const documents = useDocuments(orderSubmissionSession);
  const refreshDocuments = useRefreshDocuments();
  const [pulled, setPulled] = useState(false);

  const submittedCategories = new Set(
    classifications.filter((claim) => claim.status === 'submitted').map((claim) => claim.category),
  );
  const submissionBlockedReason = hasError
    ? 'Your verification could not be loaded.'
    : isLoading || isRefreshing
      ? 'Refreshing your verification before continuing.'
      : null;

  return (
    <>
      <Page
        testID="verification-scroll"
        title="Verification"
        refreshControl={
          <RefreshControl
            refreshing={pulled}
            onRefresh={() => {
              setPulled(true);
              void Promise.all([retry(), refreshDocuments()]).finally(() => setPulled(false));
            }}
            tintColor={theme.colors.interactive.active}
          />
        }
      >
        {isLoading ? (
          <Text accessibilityLiveRegion="polite" style={styles.muted}>
            Loading your verification…
          </Text>
        ) : hasError ? (
          <View style={look.state}>
            <Text accessibilityRole="alert" style={styles.text}>
              Your verification could not be loaded.
            </Text>
            <Actions>
              <Action label="Try again" disabled={isRefreshing} onPress={() => void retry()} />
            </Actions>
          </View>
        ) : (
          <>
            <Section title="Your claims">
              {withdraw.isError && (
                <Text accessibilityRole="alert" style={styles.error}>
                  {failureSentence(withdraw.error, 'Your claim could not be withdrawn. Try again.')}
                </Text>
              )}
              {classifications.length === 0 ? (
                <Text style={styles.muted}>No claims yet. Choose a category below.</Text>
              ) : (
                <Rows>
                  {classifications.map((claim) => {
                    const state = investorClaimState(claim);
                    const action =
                      withdraw.isPending && withdraw.variables === claim.uuid ? 'Withdrawing…' : 'Withdraw claim';
                    return (
                      <View key={claim.uuid} style={look.record}>
                        <View style={look.top}>
                          <View style={look.heading}>
                            <Text accessibilityRole="header" style={look.name}>
                              {claim.categoryDisplay}
                            </Text>
                            <Status tone={state.tone}>{state.label}</Status>
                          </View>
                          {claim.status === 'submitted' && (
                            <Actions>
                              <Action
                                label={action}
                                accessibilityLabel={`${action} (${claim.categoryDisplay}, submitted ${formatDate(claim.submittedAt ?? claim.createdAt)})`}
                                disabled={withdraw.isPending}
                                onPress={() => setWithdrawing(claim)}
                              />
                            </Actions>
                          )}
                        </View>
                        {!!(claim.submittedAt || claim.reviewedAt || claim.expiresAt) && (
                          <Rows>
                            {!!claim.submittedAt && <Fact label="Submitted">{formatDate(claim.submittedAt)}</Fact>}
                            {!!claim.reviewedAt && <Fact label="Reviewed">{formatDate(claim.reviewedAt)}</Fact>}
                            {!!claim.expiresAt && <Fact label="Expires">{formatDate(claim.expiresAt)}</Fact>}
                          </Rows>
                        )}
                        {!!claim.rejectionReason && (
                          <Text style={[styles.muted, look.reason]}>{claim.rejectionReason}</Text>
                        )}
                      </View>
                    );
                  })}
                </Rows>
              )}
            </Section>
            <Section title="How you qualify">
              <Rows>
                {CATEGORIES.map((item) => {
                  const label = submittedCategories.has(item.category) ? 'Add evidence' : 'Submit evidence';
                  return (
                    <View key={item.category} style={[look.record, look.top]}>
                      <View style={look.heading}>
                        <Text accessibilityRole="header" style={look.name}>
                          {item.label}
                        </Text>
                        <Text style={styles.muted}>{item.evidence}</Text>
                        <Text style={look.section}>{item.section}</Text>
                      </View>
                      <Actions>
                        <Action
                          label={label}
                          accessibilityLabel={`${label} (${item.label})`}
                          disabled={withdraw.isPending || isRefreshing}
                          onPress={() => setClaimCategory(item.category)}
                        />
                      </Actions>
                    </View>
                  );
                })}
              </Rows>
              <Text style={styles.muted}>
                After adding evidence, request eligibility from the exact company and consent to sharing it. The company
                records its own decision; new actions recheck that decision and its scope.
              </Text>
            </Section>
          </>
        )}
        <Section title="Supporting payslips">
          <DocumentsPanel documents={documents} />
        </Section>
      </Page>
      {withdrawing && (
        <CustomModal
          visible
          title="Withdraw this claim?"
          busy={withdraw.isPending}
          onClose={() => setWithdrawing(null)}
          actions={
            <Action
              label={withdraw.isPending ? 'Withdrawing…' : 'Withdraw claim'}
              primary
              disabled={withdraw.isPending}
              onPress={() => withdraw.mutate(withdrawing.uuid, { onSettled: () => setWithdrawing(null) })}
            />
          }
        >
          <Text style={styles.text}>
            Your {withdrawing.categoryDisplay} claim is withdrawn and can’t be shared again. Any company eligibility
            that relies on it ends. You can submit new evidence later.
          </Text>
        </CustomModal>
      )}
      <ClaimModal
        category={claimCategory}
        onClose={() => setClaimCategory(null)}
        submissionBlockedReason={submissionBlockedReason}
        onRetry={hasError ? () => void retry() : undefined}
        isRetrying={isRefreshing}
        onSuccess={() => {
          setClaimCategory(null);
          void refresh();
        }}
      />
    </>
  );
}
