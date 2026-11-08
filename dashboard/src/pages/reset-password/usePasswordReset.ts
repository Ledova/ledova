import { useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  confirmPasswordReset,
  newPasswordProblem,
  PASSWORD_PROBLEMS,
  readApiError,
  requestPasswordReset,
  type FormErrors,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { clearSessionQueries } from '@utils/session';

const INCOMPLETE_LINK = 'This reset link is incomplete. Request a new link.';

function readProof(fragment: string) {
  const parameters = new URLSearchParams(fragment.replace(/^#/, ''));
  const uid = parameters.get('uid');
  const token = parameters.get('token');
  return uid && token ? { uid, token } : null;
}

export function usePasswordReset(fragment: string) {
  const queryClient = useQueryClient();
  const owner = useRef({});
  const [proof, setProof] = useState(() => readProof(fragment));
  const [form, setForm] = useState({ email: '', newPassword: '', confirmPassword: '' });
  const [errors, setErrors] = useState<FormErrors>({});
  const [generalError, setGeneralError] = useState<string | null>(fragment && !proof ? INCOMPLETE_LINK : null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [complete, setComplete] = useState(false);

  useLayoutEffect(() => {
    function consumeLink() {
      if (!window.location.hash) return;
      const incoming = readProof(window.location.hash);
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
      owner.current = {};
      setProof(incoming);
      setForm({ email: '', newPassword: '', confirmPassword: '' });
      setErrors({});
      setGeneralError(incoming ? null : INCOMPLETE_LINK);
      setSent(false);
      setComplete(false);
      setIsSubmitting(false);
    }
    consumeLink();
    window.addEventListener('hashchange', consumeLink);
    return () => {
      owner.current = {};
      window.removeEventListener('hashchange', consumeLink);
    };
  }, []);

  function setFieldValue(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors({});
    setGeneralError(null);
  }

  function requestNewLink() {
    if (isSubmitting) return;
    owner.current = {};
    setProof(null);
    setForm({ email: '', newPassword: '', confirmPassword: '' });
    setSent(false);
    setErrors({});
    setGeneralError(null);
  }

  async function submit() {
    if (isSubmitting || complete) return;
    const problems: FormErrors = {};
    if (proof) {
      const problem = form.newPassword.trim() ? newPasswordProblem(form.newPassword) : 'Enter your new password.';
      if (problem) problems.newPassword = [problem];
      if (form.newPassword !== form.confirmPassword) problems.confirmPassword = [PASSWORD_PROBLEMS.MATCH];
    } else if (!form.email.trim()) problems.email = ['Enter your email address.'];
    setErrors(problems);
    setGeneralError(null);
    if (Object.keys(problems).length > 0) return;
    setIsSubmitting(true);
    const submittedBy = owner.current;
    try {
      if (proof) {
        await confirmPasswordReset(apiClient, { ...proof, newPassword: form.newPassword });
        clearSessionQueries(queryClient);
        if (owner.current !== submittedBy) return;
        setForm({ email: '', newPassword: '', confirmPassword: '' });
        setProof(null);
        setComplete(true);
      } else {
        await requestPasswordReset(apiClient, { email: form.email.trim() });
        if (owner.current !== submittedBy) return;
        setSent(true);
      }
    } catch (error) {
      if (owner.current !== submittedBy) return;
      const fallback = proof
        ? 'Unable to reset your password. Try again.'
        : 'Unable to request a reset link. Try again.';
      const reading = readApiError(error, {
        fallback,
        displayedFields: proof ? ['newPassword'] : ['email'],
        unanswered: fallback,
      });
      setErrors(reading.fieldErrors ?? {});
      setGeneralError(reading.generalError ?? null);
    } finally {
      if (owner.current === submittedBy) setIsSubmitting(false);
    }
  }

  return {
    form,
    errors,
    generalError,
    isSubmitting,
    sent,
    complete,
    hasProof: proof !== null,
    setFieldValue,
    requestNewLink,
    submit,
  };
}
