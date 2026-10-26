import { useState } from 'react';
import { Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import {
  FIELD_LIMITS,
  INVITATION_CODE_PROBLEM,
  failureSentence,
  failureStatus,
  formatDate,
  isInvitationCode,
  ownMemberRecordsKey,
  previewMemberInvitation,
  type UserFriendlyError,
} from '@ledova/shared';
import { Action, useCardStyles } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { Field } from '../../components/register/RegisterFields';
import { useThemedStyles } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { apiClient } from '../../services/apiClient';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { Avatar } from './CompanyHoldings';
import { MemberNotice, useMemberRecordsState } from './MemberRecordsProvider';

export function InvitationScreen() {
  const styles = useCompanyStyles();
  const card = useCardStyles();
  const look = useThemedStyles((theme) => ({
    invite: { alignItems: 'center' as const, gap: theme.spacing.sm },
    company: { fontFamily: theme.fontFamily.display, fontSize: 22, color: theme.colors.text.primary },
    centred: { textAlign: 'center' as const },
    actions: { gap: theme.spacing.sm },
  }));
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
        !data.intendedEmail ||
        !['pending', 'accepted'].includes(data.status)
      )
        throw new Error('This invitation could not be confirmed. Check the code and try again.');
      return data;
    },
  });
  const shown = valid && preview.isSuccess ? preview.data : null;
  const accepted =
    !!shown &&
    (shown.status === 'accepted' ||
      read.records.some((record) => record.company.uuid === shown.company.uuid && record.member === shown.member.uuid));
  const held = read.busy || !!read.retry;
  return (
    <Page testID="invitation-scroll" title="Invitation">
      <MemberNotice read={read} />
      <Field
        label="Code from the email"
        value={code}
        editable={!held && !accepted}
        autoCapitalize="none"
        autoCorrect={false}
        error={code && !valid ? INVITATION_CODE_PROBLEM : null}
        onChange={(value) => setCode(value.trim().slice(0, FIELD_LIMITS.INVITATION_CODE))}
      />
      {valid && preview.isPending ? (
        <Text style={styles.muted}>Checking your invitation…</Text>
      ) : valid && preview.isError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {failureStatus((preview.error as UserFriendlyError).originalError ?? preview.error) === 404
            ? 'No invitation matches this code. Check it against the email.'
            : failureSentence(preview.error, 'Your invitation could not be checked. Check the code and try again.')}
        </Text>
      ) : shown ? (
        <View style={[card.card, look.invite]}>
          <Avatar name={shown.company.name} />
          <Text style={[look.company, look.centred]}>{shown.company.name}</Text>
          <Text style={[styles.muted, look.centred]}>
            invites {shown.intendedEmail} to see their shares and documents.
          </Text>
          <Text style={[styles.muted, look.centred]}>
            Recorded as {shown.member.name} · accept by {formatDate(shown.acceptanceDeadline)}
          </Text>
        </View>
      ) : null}
      {accepted ? (
        <View style={look.actions}>
          <Text style={styles.text}>Invitation accepted. Your company records are available.</Text>
          <Action label="View my shares" primary onPress={() => navigation.popTo('Main', { screen: 'Holdings' })} />
        </View>
      ) : (
        <View style={look.actions}>
          {shown?.status === 'pending' && (
            <Action label="Accept invitation" primary disabled={held} onPress={() => void read.accept(code)} />
          )}
          <Action label="Not now" disabled={read.busy} onPress={() => navigation.goBack()} />
        </View>
      )}
    </Page>
  );
}
