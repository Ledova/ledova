import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getUserProfiles,
  updateUserProfile,
  CACHE_TIMING,
  AUTH_QUERY_KEY,
  USER_PREFERENCES_QUERY_KEY,
  useSubmissionOwner,
  type UpdateUserProfile,
} from '@ledova/shared';
import apiClient from '@services/apiClient';

type PersonalDetails = Pick<UpdateUserProfile, 'fullName' | 'residentialAddress' | 'phoneCountryCode' | 'phoneNumber'>;

export function useUserProfile() {
  const client = useQueryClient();
  const { owner, boundary } = useSubmissionOwner();
  const id = useId();
  const [generation, setGeneration] = useState({ owner, value: 0 });
  if (generation.owner !== owner) setGeneration({ owner, value: generation.value + 1 });
  const key = ['userProfiles', owner?.userUuid, owner?.ownerAccountUuid, id, generation.value];
  const mounted = useRef(true);
  const pending = useRef(false);
  const transport = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      transport.current?.abort();
    };
  }, []);
  useEffect(() => () => transport.current?.abort(), [owner]);
  const guard = () => {
    const auth = client.getQueryState<{ data: { valid: boolean } }>(AUTH_QUERY_KEY);
    if (
      !mounted.current ||
      !owner ||
      boundary.get() !== owner ||
      auth?.status !== 'success' ||
      !auth.data?.data.valid ||
      client.getQueryState(USER_PREFERENCES_QUERY_KEY)?.status !== 'success'
    )
      throw new Error('Your signed-in account changed. Reopen Profile.');
  };
  const profile = useQuery({
    queryKey: key,
    enabled: !!owner,
    queryFn: async ({ signal }) => {
      guard();
      const response = await getUserProfiles(apiClient, {
        signal,
        ledovaSubmissionGuard: guard,
      });
      guard();
      if (response.data.results.length > 1 || response.data.results.some((row) => row.uuid !== owner!.userUuid))
        throw new Error('Your own profile could not be confirmed.');
      return response;
    },
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
    gcTime: CACHE_TIMING.EXTRA_LONG_GC_TIME,
  });
  const preferences = client.getQueryState(USER_PREFERENCES_QUERY_KEY);
  const ownerReady =
    !!owner && preferences?.status === 'success' && preferences.fetchStatus === 'idle' && !preferences.isInvalidated;
  const userProfile = ownerReady && profile.isSuccess ? (profile.data.data.results[0] ?? null) : null;
  const snapshot = JSON.stringify(userProfile);
  const sourceKey = userProfile ? JSON.stringify([...key, snapshot]) : null;
  const ownerKey = owner && preferences?.status === 'success' ? JSON.stringify(key) : null;
  const update = useMutation({
    mutationFn: async ({ data }: { data: PersonalDetails }) => {
      const sourceGuard = () => {
        guard();
        const query = client.getQueryState(key);
        const preferences = client.getQueryState(USER_PREFERENCES_QUERY_KEY);
        if (
          !userProfile ||
          userProfile.uuid !== owner?.userUuid ||
          query?.status !== 'success' ||
          query.fetchStatus !== 'idle' ||
          query.isInvalidated ||
          preferences?.fetchStatus !== 'idle' ||
          preferences.isInvalidated ||
          JSON.stringify(client.getQueryData<typeof profile.data>(key)?.data.results[0] ?? null) !== snapshot
        )
          throw new Error('Your profile changed or could not be refreshed. Refresh before saving.');
      };
      sourceGuard();
      const controller = new AbortController();
      transport.current = controller;
      try {
        const response = await updateUserProfile(apiClient, userProfile!.uuid, data, {
          signal: controller.signal,
          ledovaSubmissionGuard: sourceGuard,
        });
        sourceGuard();
        if (response.data.uuid !== userProfile!.uuid) throw new Error('Your saved profile could not be confirmed.');
        return response;
      } finally {
        if (transport.current === controller) transport.current = null;
      }
    },
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });
  const updateProfile = (data: PersonalDetails, onSuccess: () => void) => {
    if (!userProfile || profile.isFetching || profile.isError || update.isPending || pending.current) return;
    pending.current = true;
    const body = Object.freeze({
      fullName: data.fullName,
      residentialAddress: data.residentialAddress,
      phoneCountryCode: data.phoneCountryCode,
      phoneNumber: data.phoneNumber,
    });
    update.mutate(
      { data: body },
      {
        onSuccess: () => {
          if (boundary.get() === owner && mounted.current) onSuccess();
        },
        onSettled: () => {
          pending.current = false;
        },
      },
    );
  };
  const state = {
    ...profile,
    isLoading: preferences?.status !== 'error' && (!ownerReady || profile.isLoading),
    isError: preferences?.status === 'error' || profile.isError,
    isFetching: preferences?.fetchStatus === 'fetching' || profile.isFetching,
  };
  return {
    userProfile,
    isLoading: state.isLoading,
    isError: state.isError,
    isFetching: state.isFetching,
    refreshProfile: () => profile.refetch(),
    updateProfile,
    isUpdating: update.isPending,
    updateError: update.isError,
    resetUpdate: update.reset,
    sourceKey,
    ownerKey,
  };
}
