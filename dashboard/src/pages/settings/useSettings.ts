import { clearSessionQueries } from '@utils/session';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  USER_PREFERENCES_QUERY_KEY,
  deleteAccount,
  changePassword,
  exportAccountData,
  newPasswordProblem,
  PASSWORD_PROBLEMS,
  upsertCurrentUserPreferences,
  useUserPreferences,
  useSubmissionOwner,
  createUserFriendlyError,
  type UserPreferences,
  utcToday,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { SIGNIN_PATH } from '@utils/paths';
import { saveFile } from '@utils/saveFile';
import { useTheme } from '@hooks/useTheme';
import { hasProblems, type Problems } from '@hooks/useErrorSummary';

export function useSettings() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const preferences = useUserPreferences();
  const { owner, boundary } = useSubmissionOwner();
  const theme = useTheme();
  const transactionAlerts = preferences.preferences?.transactionAlerts;
  const alerts = useMutation({
    mutationFn: async (value: boolean) => {
      const submittedOwner = owner;
      const cached = queryClient.getQueryData<{ data: UserPreferences }>(USER_PREFERENCES_QUERY_KEY);
      const guard = () => {
        const state = queryClient.getQueryState(USER_PREFERENCES_QUERY_KEY);
        if (
          !submittedOwner ||
          boundary.get() !== submittedOwner ||
          !cached ||
          cached.data.userProfile !== submittedOwner.userUuid ||
          cached.data.userAccount?.uuid !== submittedOwner.ownerAccountUuid ||
          state?.status !== 'success' ||
          state.fetchStatus !== 'idle' ||
          state.isInvalidated ||
          state.data !== cached
        )
          throw createUserFriendlyError('Your account changed or could not be checked. Reopen Profile before saving.');
      };
      guard();
      const response = await upsertCurrentUserPreferences(
        apiClient,
        { transactionAlerts: value },
        { ledovaSubmissionGuard: guard },
      );
      guard();
      if (
        response.data.uuid !== cached!.data.uuid ||
        response.data.userProfile !== submittedOwner!.userUuid ||
        response.data.userAccount?.uuid !== submittedOwner!.ownerAccountUuid ||
        response.data.userAccount?.role !== cached!.data.userAccount?.role ||
        response.data.transactionAlerts !== value
      )
        throw createUserFriendlyError('Your notification preference could not be confirmed. Try again.');
      return { cached: { ...cached!, data: { ...cached!.data, transactionAlerts: value } }, guard };
    },
    onSuccess: ({ cached, guard }) => {
      guard();
      queryClient.setQueryData(USER_PREFERENCES_QUERY_KEY, cached);
    },
  });
  const [modal, setModal] = useState<'password' | 'export' | 'delete' | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordChanged, setPasswordChanged] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: () => deleteAccount(apiClient),
    onSuccess: () => {
      clearSessionQueries(queryClient);
      navigate(SIGNIN_PATH);
    },
  });
  const passwordMutation = useMutation({
    mutationFn: () => changePassword(apiClient, { currentPassword, newPassword, newPasswordConfirm: confirmPassword }),
    onSuccess: () => {
      setModal(null);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordChanged(true);
    },
  });
  const exportMutation = useMutation({
    mutationFn: () => exportAccountData(apiClient),
    onSuccess: (response) => {
      const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
      saveFile(blob, `ledova-data-export-${utcToday()}.json`);
      setModal(null);
    },
  });

  function closePassword() {
    setModal(null);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    passwordMutation.reset();
  }

  const passwordProblems: Problems<'currentPassword' | 'newPassword' | 'newPasswordConfirm'> = {
    currentPassword: !currentPassword && PASSWORD_PROBLEMS.CURRENT,
    newPassword: newPasswordProblem(newPassword),
    newPasswordConfirm: newPassword !== confirmPassword && PASSWORD_PROBLEMS.MATCH,
  };

  function savePassword() {
    if (passwordMutation.isPending || hasProblems(passwordProblems)) return;
    passwordMutation.mutate();
  }

  return {
    preferences,
    theme,
    transactionAlerts,
    alerts,
    modal,
    setModal,
    currentPassword,
    setCurrentPassword,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
    passwordProblems,
    passwordChanged,
    setPasswordChanged,
    deleteMutation,
    passwordMutation,
    exportMutation,
    closePassword,
    savePassword,
  };
}
