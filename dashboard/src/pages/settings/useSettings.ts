import { clearSessionQueries } from '@utils/session';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  deleteAccount,
  changePassword,
  exportAccountData,
  newPasswordProblem,
  PASSWORD_PROBLEMS,
  assertSessionSettled,
  useSubmissionOwner,
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
  const { owner, boundary } = useSubmissionOwner();
  const theme = useTheme();
  const [modal, setModal] = useState<'password' | 'export' | 'delete' | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordChanged, setPasswordChanged] = useState(false);

  const accountGuard = () => {
    if (!owner || boundary.get() !== owner) throw new Error('Your signed-in account changed. Reopen Settings.');
    assertSessionSettled(queryClient);
  };
  const deleteMutation = useMutation({
    mutationFn: () => {
      accountGuard();
      return deleteAccount(apiClient, { ledovaSubmissionGuard: accountGuard });
    },
    onSuccess: () => {
      clearSessionQueries(queryClient);
      navigate(SIGNIN_PATH);
    },
  });
  const passwordMutation = useMutation({
    mutationFn: () => {
      accountGuard();
      return changePassword(
        apiClient,
        { currentPassword, newPassword, newPasswordConfirm: confirmPassword },
        { ledovaSubmissionGuard: accountGuard },
      );
    },
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
    theme,
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
