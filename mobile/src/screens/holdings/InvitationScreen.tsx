import { useEffect, useState } from 'react';
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
import { Action, Actions, useCardStyles } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { Field } from '../../components/register/RegisterFields';
import { useThemedStyles } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { apiClient } from '../../services/apiClient';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { Avatar } from '../../components/Avatar';
import { MemberNotice, useMemberRecordsState } from './MemberRecordsProvider';

function codeOf(value: string) {
  const text = value.trim();
  return text
    .slice(text.lastIndexOf('#') + 1)
    .trim()
    .slice(0, FIELD_LIMITS.INVITATION_CODE);
}

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
  const accepted = shown?.status === 'accepted' && read.retry?.kind !== 'accept';
  const held = read.busy || !!read.retry;
  return (
    <Page testID="invitation-scroll" title="Invitation">
      <MemberNotice read={read} />
      <Field
        label="Link or code from the email"
        value={code}
        editable={!held && !accepted}
        autoCapitalize="none"
        autoCorrect={false}
        error={code && !valid ? INVITATION_CODE_PROBLEM : null}
        onChange={(value) => setCode(codeOf(value))}
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
          <Text accessibilityLiveRegion="polite" style={styles.text}>
            Invitation accepted. Your company records are available.
          </Text>
          <Actions>
            <Action label="View my shares" primary onPress={() => navigation.popTo('Dashboard')} />
          </Actions>
        </View>
      ) : (
        <Actions>
          <Action label="Not now" disabled={read.busy} onPress={() => navigation.goBack()} />
          {shown?.status === 'pending' && (
            <Action label="Accept invitation" primary disabled={held} onPress={() => void read.accept(code)} />
          )}
        </Actions>
      )}
    </Page>
  );
}
