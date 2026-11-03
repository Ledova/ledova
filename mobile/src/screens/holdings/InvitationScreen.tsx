import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import {
  INVITATION_CODE_PROBLEM,
  failureSentence,
  failureStatus,
  formatDate,
  invitationCodeFrom,
  isInvitationCode,
  ownMemberRecordsKey,
  previewMemberInvitation,
  type UserFriendlyError,
} from '@ledova/shared';
import { Action, Actions, Fact, FormActions, Rows, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { Field } from '../../components/register/RegisterFields';
import { useThemedStyles } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { apiClient } from '../../services/apiClient';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { MemberNotice, useMemberRecordsState } from './MemberRecordsProvider';

export function InvitationScreen() {
  const styles = useCompanyStyles();
  const look = useThemedStyles((theme) => ({ actions: { gap: theme.spacing.sm } }));
  const navigation = useNavigation<NativeStackNavigationProp<SignedInStackParamList>>();
  const { read } = useMemberRecordsState();
  const [code, setCode] = useState('');
  const valid = isInvitationCode(code);
  const preview = useQuery({
    queryKey: [...ownMemberRecordsKey(read.owner, orderSubmissionSession.getEpoch()), 'invitation', code],
    enabled: !!read.owner && valid,
    gcTime: 0,
    retry: false,
    queryFn: async () => {
      const { data } = await previewMemberInvitation(apiClient, code, orderSubmissionSession.requestConfig());
      if (
        !data.company?.uuid ||
        !data.company.name ||
        !data.member?.uuid ||
        !data.member.name ||
        !data.intendedEmail ||
        !data.acceptanceDeadline ||
        !['pending', 'accepted'].includes(data.status)
      )
        throw new Error('This invitation could not be confirmed. Check the code and try again.');
      return data;
    },
  });
  const refetchPreview = preview.refetch;
  useEffect(() => {
    if (read.owner && valid && !read.busy) void refetchPreview({ cancelRefetch: false });
  }, [read.owner, valid, read.busy, refetchPreview]);
  const shown = read.owner && valid && preview.isSuccess ? preview.data : null;
  const accepted = shown?.status === 'accepted' && !read.retry;
  const held = read.busy || !!read.retry;
  return (
    <Page testID="invitation-scroll" title="Member invitation">
      <MemberNotice read={read} />
      <Section title="Access to your shares">
        <Text style={styles.muted}>Paste the invitation link or its code from your company’s email.</Text>
        <Field
          label="Link or code from the email"
          value={code}
          editable={!held && !accepted}
          autoCapitalize="none"
          autoCorrect={false}
          error={code && !valid ? INVITATION_CODE_PROBLEM : null}
          onChange={(value) => setCode(invitationCodeFrom(value))}
        />
        {!read.owner ? (
          <Text style={styles.muted}>Check your signed-in account before accepting an invitation.</Text>
        ) : valid && preview.isError ? (
          <View style={look.actions}>
            <Text accessibilityRole="alert" style={styles.error}>
              {failureStatus((preview.error as UserFriendlyError).originalError ?? preview.error) === 404
                ? 'No invitation matches this code. Check it against the email.'
                : failureSentence(preview.error, 'Your invitation could not be checked. Check the code and try again.')}
            </Text>
            <Actions>
              <Action label="Try again" disabled={preview.isFetching} onPress={() => void preview.refetch()} />
            </Actions>
          </View>
        ) : valid && !shown ? (
          <Text style={styles.muted}>Checking your invitation…</Text>
        ) : shown ? (
          <>
            <Rows>
              <Fact label="Company">{shown.company.name}</Fact>
              <Fact label="Shareholder">{shown.member.name}</Fact>
              <Fact label="Email">{shown.intendedEmail}</Fact>
              <Fact label="Accept by">{formatDate(shown.acceptanceDeadline)}</Fact>
            </Rows>
            {shown.status === 'pending' && (
              <Text style={styles.muted}>Accept access to your own shares and employee awards with this company.</Text>
            )}
          </>
        ) : null}
        {accepted ? (
          <View style={look.actions}>
            <Text accessibilityLiveRegion="polite" style={styles.text}>
              Invitation accepted. Your company records are available.
            </Text>
            <FormActions>
              <Action label="View my shares" primary onPress={() => navigation.popTo('Dashboard')} />
            </FormActions>
          </View>
        ) : (
          <FormActions>
            <Action label="Not now" disabled={read.busy} onPress={() => navigation.goBack()} />
            {shown?.status === 'pending' && (
              <Action label="Accept invitation" primary disabled={held} onPress={() => void read.accept(code)} />
            )}
          </FormActions>
        )}
      </Section>
    </Page>
  );
}
