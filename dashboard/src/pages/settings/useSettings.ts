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
  utcToday,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { SIGNIN_PATH } from '@utils/paths';
import { saveFile } from '@utils/saveFile';
import { hasProblems, type Problems } from '@hooks/useErrorSummary';

export function useSettings() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
