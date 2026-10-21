import { Field, TextArea, TextInput } from '@components/Field';
import { Choices } from '@components/Choices';
import { FileIcon, UploadSimpleIcon, XIcon } from '@phosphor-icons/react';
import { Modal } from '@components/Modal';
import { PageAction } from '@components/Page';
import { FIELD_LIMITS, UPLOAD_RULE, addCalendarDays, addCalendarYears, formatFileSize, utcToday } from '@ledova/shared';
import type { InvestorCategory } from '@ledova/shared';
import { useInvestorClaim } from './useInvestorClaim';
import { CERTIFIER_BODIES, WHOLESALE_ONLY_NOTICE } from './constants';
import { LoadError } from '@components/Ledger';

interface ClaimModalProps {
  isOpen: boolean;
  onClose: () => void;
  category: InvestorCategory | null;
  userAccount: string | null;
  onSuccess: () => void;
  submissionBlockedReason: string | null;
  onRetry?: () => void;
  isRetrying: boolean;
}

export function ClaimModal({
  isOpen,
  onClose,
  category,
  userAccount,
  onSuccess,
  submissionBlockedReason,
  onRetry,
  isRetrying,
}: ClaimModalProps) {
  const {
    file,
    chooseFile,
    fileRefusal,
    declaredBasis,
    setDeclaredBasis,
    company,
    setCompany,
    certificateIssuedAt,
    setCertificateIssuedAt,
    certifierName,
    setCertifierName,
    certifierBody,
    setCertifierBody,
    certifierMembershipNumber,
    setCertifierMembershipNumber,
    declarationAccepted,
    setDeclarationAccepted,
    isSubmitting,
    isDragging,
    setIsDragging,
    error,
    fileInputRef,
    needsCompany,
    needsCertifier,
    spec,
    reset,
    handleDrop,
    isComplete,
    handleSubmit,
  } = useInvestorClaim({ category, userAccount, onSuccess, submissionBlockedReason });

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        reset();
        onClose();
      }}
      title={spec ? `Claim: ${spec.label}` : 'Claim'}
      size="lg"
      showFooter
      confirmLabel="Save private evidence"
      onConfirm={handleSubmit}
      confirmDisabled={!isComplete}
      busy={isSubmitting}
      busyLabel="Saving…"
    >
      <div className="space-y-4">
        {submissionBlockedReason &&
          (onRetry ? (
            <LoadError retry={onRetry} busy={isRetrying}>
              {submissionBlockedReason}
            </LoadError>
          ) : (
            <p role="status" className="text-sm text-text-primary">
              {submissionBlockedReason}
            </p>
          ))}
        {error && (
          <p role="alert" className="text-sm text-error-light">
            {error}
          </p>
        )}

        <p className="text-sm text-text-secondary">{spec?.evidence}</p>

        {needsCompany && (
          <Field
            label="Issuer company UUID"
            hint="Enter the exact company UUID provided by the issuer. The server checks that it is active."
          >
            <TextInput
              value={company}
              onChange={(e) => {
                if (!isSubmitting) setCompany(e.target.value);
              }}
              disabled={isSubmitting}
            />
          </Field>
        )}

        {needsCertifier && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Certificate date (UTC)">
              <TextInput
                type="date"
                min={addCalendarYears(addCalendarDays(utcToday(), 1), -2)}
                max={utcToday()}
                value={certificateIssuedAt}
                onChange={(e) => setCertificateIssuedAt(e.target.value)}
              />
            </Field>
            <Choices
              legend="Professional body"
              options={CERTIFIER_BODIES.map((body) => [body.value, body.label] as const)}
              value={certifierBody}
              onChange={setCertifierBody}
            />
            <Field label="Accountant name">
              <TextInput
                value={certifierName}
                maxLength={FIELD_LIMITS.CERTIFIER_NAME}
                onChange={(e) => setCertifierName(e.target.value)}
              />
            </Field>
            <Field label="Membership number">
              <TextInput
                value={certifierMembershipNumber}
                maxLength={FIELD_LIMITS.MEMBERSHIP_NUMBER}
                onChange={(e) => setCertifierMembershipNumber(e.target.value)}
              />
            </Field>
          </div>
        )}

        <Field label="Basis for the claim">
          <TextArea
            value={declaredBasis}
            onChange={(e) => setDeclaredBasis(e.target.value)}
            rows={3}
            placeholder="Describe, in your own words, why this category applies to you"
          />
        </Field>

        {!file ? (
          <div
            onDrop={handleDrop}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            className={`flex flex-col items-center justify-center gap-3 py-10 px-6 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
              isDragging
                ? 'border-brand-light bg-brand-mid/10'
                : 'border-border hover:border-brand-subtle hover:bg-surface-tertiary'
            }`}
          >
            <UploadSimpleIcon size={32} className="text-text-muted" weight="light" />
            <div className="text-center">
              <p className="mb-3 text-sm text-text-primary">Drag and drop your evidence or choose a file.</p>
              <PageAction label="Choose evidence file" onClick={() => fileInputRef.current?.click()} />
              <p className="text-xs text-text-muted mt-1">{UPLOAD_RULE.HINT}</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              aria-label="Evidence file"
              accept={UPLOAD_RULE.ACCEPT}
              onChange={(e) => {
                chooseFile(e.target.files?.[0] ?? null);
                e.target.value = '';
              }}
              className="hidden"
            />
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <FileIcon size={24} className="text-brand-light flex-shrink-0" weight="regular" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-text-primary truncate">{file.name}</p>
              <p className="text-xs text-text-muted">{formatFileSize(file.size)}</p>
            </div>
            <button
              type="button"
              aria-label="Remove evidence file"
              onClick={() => chooseFile(null)}
              className="text-text-muted hover:text-text-primary p-1"
            >
              <XIcon size={16} />
            </button>
          </div>
        )}
        {fileRefusal && (
          <p role="alert" className="text-sm text-error-light">
            {fileRefusal}
          </p>
        )}

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={declarationAccepted}
            onChange={(e) => setDeclarationAccepted(e.target.checked)}
            className="mt-1"
          />
          <span className="text-sm text-text-secondary">
            I declare that this category applies to me and that the evidence attached is genuine.{' '}
            {WHOLESALE_ONLY_NOTICE}
          </span>
        </label>
      </div>
    </Modal>
  );
}
