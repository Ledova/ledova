import {
  AuthCard,
  AuthInput,
  AuthDivider,
  authFieldClass,
  AuthSubmit,
  AuthAlert,
  AuthBack,
  AuthField,
} from '@components/auth';
import { UserIcon } from '@phosphor-icons/react';
import { FIELD_LIMITS } from '@ledova/shared';
import type { FormErrors, UserProfileFormValidation, UserProfileFormData } from '@ledova/shared';
import { ICON_MD } from '@components/iconSizes';
import { ErrorSummary } from '@components/ErrorSummary';
import { useFieldErrorSummary } from '@hooks/useErrorSummary';

interface UserProfileFormProps {
  form: UserProfileFormData;
  errors: FormErrors;
  generalError: string;
  isSubmitting: boolean;
  formValidation: UserProfileFormValidation;
  setFieldValue: (field: keyof UserProfileFormData, value: string) => void;
  onSubmit: (e: React.FormEvent) => Promise<void>;
  onBack: () => void;
}

export function UserProfileForm({
  form,
  errors,
  generalError,
  isSubmitting,
  formValidation,
  setFieldValue,
  onSubmit,
  onBack,
}: UserProfileFormProps) {
  const reported = useFieldErrorSummary(generalError ? {} : errors, ['fullName']);
  const fullName = reported.field('fullName');
  const submit = (event: React.FormEvent) => void onSubmit(event).then(reported.reported);
  return (
    <>
      <AuthCard>
        <form noValidate onSubmit={submit} className="space-y-6">
          <ErrorSummary {...reported.summary} />
          {generalError && <AuthAlert>{generalError}</AuthAlert>}

          <AuthField
            id={fullName.id}
            label="Full name"
            icon={<UserIcon size={ICON_MD} className="text-text-subtle" />}
            error={fullName.error}
          >
            <AuthInput
              type="text"
              name="fullName"
              maxLength={FIELD_LIMITS.PROFILE_NAME}
              value={form.fullName}
              onChange={(e) => setFieldValue('fullName', e.target.value)}
              className={authFieldClass(
                (formValidation && !formValidation.fullName.isValid && form.fullName) || errors.fullName,
                'pl-10 pr-3',
              )}
              placeholder="John Doe"
              required
              invalid={!!fullName.error}
              disabled={isSubmitting}
            />
          </AuthField>

          <AuthSubmit busy={isSubmitting} busyLabel="Saving…">
            Continue
          </AuthSubmit>
        </form>
      </AuthCard>

      <AuthDivider />

      <div className="text-center">
        {onBack && (
          <p className="text-sm text-text-subtle">
            <AuthBack onClick={onBack} disabled={isSubmitting} />
          </p>
        )}
      </div>
    </>
  );
}
