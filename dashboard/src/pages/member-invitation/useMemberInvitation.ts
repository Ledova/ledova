import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AUTH_QUERY_KEY,
  USER_PREFERENCES_QUERY_KEY,
  acceptMemberInvitation,
  failureSentence,
  previewMemberInvitation,
  useAuth,
  useSubmissionOwner,
  useUserPreferences,
  useUserProfile,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { captureMemberInvitation, clearMemberInvitation } from '@utils/memberInvitation';

export function useMemberInvitation() {
  const auth = useAuth();
  const preferences = useUserPreferences();
  const profile = useUserProfile();
  const profileSource =
    profile.userProfile?.isSignupCompleted && !profile.profile.isFetching && !profile.profile.isError
      ? profile.sourceKey
      : null;
  const currentProfileSource = useRef(profileSource);
  useEffect(() => {
    currentProfileSource.current = profileSource;
  }, [profileSource]);
  const { owner, boundary } = useSubmissionOwner();
  const client = useQueryClient();
  const [link] = useState(() => ({ code: captureMemberInvitation(), id: crypto.randomUUID() }));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ owner: typeof owner; message: string } | null>(null);
  const scope = useMemo(() => ({ owner, profileSource, id: crypto.randomUUID() }), [owner, profileSource]);
  const [accepted, setAccepted] = useState<typeof owner>(null);
  const submitting = useRef(false);
  const live = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const ready =
    !!owner &&
    auth.isAuthenticated &&
    !auth.isFetching &&
    !preferences.isFetching &&
    !preferences.isError &&
    !!profile.userProfile?.isSignupCompleted &&
    !profile.profile.isFetching &&
    !profile.profile.isError;
  const guard = () => {
    const authState = client.getQueryState(AUTH_QUERY_KEY);
    const preferenceState = client.getQueryState(USER_PREFERENCES_QUERY_KEY);
    if (
      !live.current ||
      !profileSource ||
      currentProfileSource.current !== profileSource ||
      !owner ||
      boundary.get() !== owner ||
      authState?.status !== 'success' ||
      authState.fetchStatus !== 'idle' ||
      preferenceState?.status !== 'success' ||
      preferenceState.fetchStatus !== 'idle'
    )
      throw new Error('Your signed-in account changed. Reopen the invitation email.');
  };
  const preview = useQuery({
    queryKey: ['member-invitation-preview', scope.id, link?.id],
    enabled: ready && !!link?.code && accepted !== owner,
    retry: false,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      guard();
      const response = await previewMemberInvitation(apiClient, link!.code, { signal, ledovaSubmissionGuard: guard });
      guard();
      const data = response.data;
      if (
        !data.company?.uuid ||
        !data.company.name ||
        !data.member?.uuid ||
        !data.member.name ||
        !data.intendedEmail ||
        !data.acceptanceDeadline ||
        !['pending', 'accepted'].includes(data.status)
      )
        throw new Error('The invitation details could not be confirmed. Reopen the invitation email.');
      return data;
    },
  });
  const shown = ready && preview.isSuccess && preview.fetchStatus === 'idle' ? preview.data : null;
  const currentFailure = ready && failure?.owner === owner ? failure.message : '';
  const accept = async () => {
    if (submitting.current || !shown || !link?.code || shown.status !== 'pending') return;
    submitting.current = true;
    setBusy(true);
    setFailure(null);
    try {
      guard();
      const { data } = await acceptMemberInvitation(
        apiClient,
        { code: link.code, userAccount: owner!.ownerAccountUuid, confirmation: true },
        { ledovaSubmissionGuard: guard },
      );
      guard();
      if (
        data.company !== shown.company.uuid ||
        data.member !== shown.member.uuid ||
        data.userAccount !== owner!.ownerAccountUuid ||
        !data.current
      )
        throw new Error('The accepted invitation could not be confirmed. Retry this invitation.');
      setAccepted(owner);
      clearMemberInvitation();
      await client.invalidateQueries({ queryKey: ['member-records'] });
    } catch (error) {
      if (live.current && boundary.get() === owner)
        setFailure({ owner, message: failureSentence(error, 'The invitation could not be accepted. Try again.') });
    } finally {
      submitting.current = false;
      if (live.current) setBusy(false);
    }
  };
  return {
    hasLink: !!link.code,
    auth,
    preferences,
    profile,
    setupRequired: !owner || (!!profile.userProfile && !profile.userProfile.isSignupCompleted),
    ready,
    accepted: !!owner && accepted === owner,
    preview,
    shown,
    failure: currentFailure,
    busy,
    accept,
  };
}
