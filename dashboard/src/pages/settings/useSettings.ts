import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AUTH_QUERY_KEY,
  USER_PREFERENCES_QUERY_KEY,
  deleteAccount,
  changePassword,
  exportAccountData,
  upsertCurrentUserPreferences,
  useUserPreferences,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { SIGNIN_PATH } from '@utils/paths';
import { useTheme } from '@hooks/useTheme';
import { useRegisterEntry } from '@hooks/useRegisterAccess';

export function useSettings() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const preferences = useUserPreferences();
  const registerEntry = useRegisterEntry();
  const theme = useTheme();
  const transactionAlerts = preferences.preferences?.transactionAlerts;
  const alerts = useMutation({
    mutationFn: (value: boolean) => upsertCurrentUserPreferences(apiClient, { transactionAlerts: value }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: USER_PREFERENCES_QUERY_KEY }),
  });
  const [modal, setModal] = useState<'password' | 'export' | 'delete' | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordChanged, setPasswordChanged] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: () => deleteAccount(apiClient),
    onSuccess: () => {
      queryClient.setQueryData(AUTH_QUERY_KEY, { data: { valid: false } });
      queryClient.clear();
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
    onError: (error: unknown) => {
      const data = (error as { response?: { data?: Record<string, unknown> } }).response?.data;
      if (data?.current_password || data?.currentPassword) setPasswordError('Current password is incorrect.');
      else if (data?.new_password || data?.newPassword)
        setPasswordError('The new password was not accepted. Choose another password.');
      else if (data?.new_password_confirm || data?.newPasswordConfirm) setPasswordError('Passwords do not match.');
      else setPasswordError('Your password could not be changed. Try again.');
    },
  });
  const exportMutation = useMutation({
    mutationFn: () => exportAccountData(apiClient),
    onSuccess: (response) => {
      const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ledova-data-export-${new Date().toISOString().split('T')[0]}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setModal(null);
    },
  });

  function closePassword() {
    if (passwordMutation.isPending) return;
    setModal(null);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
    passwordMutation.reset();
  }

  function savePassword() {
    if (passwordMutation.isPending) return;
    setPasswordError('');
    if (!currentPassword || !newPassword || !confirmPassword) setPasswordError('All fields are required.');
    else if (newPassword.length < 8) setPasswordError('New password must be at least 8 characters.');
    else if (newPassword !== confirmPassword) setPasswordError('Passwords do not match.');
    else passwordMutation.mutate();
  }

  return {
    preferences,
    registerEntry,
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
    passwordError,
    passwordChanged,
    setPasswordChanged,
    deleteMutation,
    passwordMutation,
    exportMutation,
    closePassword,
    savePassword,
  };
}
