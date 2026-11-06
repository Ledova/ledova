import { AuthLayout, AuthHeader, AuthDivider, AuthSubmit, AuthBack } from '@components/auth';
import { SIGNUP_PATHS, SITE_PATHS } from '@utils/paths';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ClipboardTextIcon } from '@phosphor-icons/react';
import { IdentityVerificationModal } from '@components/IdentityVerificationModal';
import { COMPANY_TYPES, formatPhoneWithCountryCode, formatSourceOfFunds, formatIntendedUse } from '@ledova/shared';
import { ICON_LG } from '@components/iconSizes';
import { useReview } from './useReview';

import { Section, Row, Rows } from '@components/Ledger';
import { SITE_URL } from '@utils/siteUrl';
import { LoadingState } from '@pages/signup/shared/LoadingState';
import { ErrorState } from '@pages/signup/shared/ErrorState';

function displayCompanyType(companyType: string | undefined) {
  return COMPANY_TYPES.find((type) => type.value === companyType)?.label ?? companyType ?? '';
}

export default function SignupReview() {
  const navigate = useNavigate();
  const {
    data,
    company,
    isCompany,
    identityRequired,
    isLoading,
    error,
    completionError,
    completeSignup,
    isSubmitting,
    canCompleteSignup,
    retryLoad,
    authorityRequest,
    authorityError,
    resetAuthorityRequest,
    isResettingAuthority,
  } = useReview();
  const [verificationOpen, setVerificationOpen] = useState(false);

  const handleBack = () => {
    if (isCompany) {
      navigate(SIGNUP_PATHS.companyRegistration);
    } else {
      navigate(SIGNUP_PATHS.financialProfile);
    }
  };

  if (isLoading) {
    return <LoadingState message="Loading your answers…" />;
  }

  if (error) return <ErrorState message={error} onRetry={retryLoad} />;

  const { userProfile, financialProfile } = data;

  return (
    <AuthLayout>
      <AuthHeader
        title={isCompany ? 'Complete company setup' : 'Review & confirm'}
        icon={<ClipboardTextIcon size={ICON_LG} className="text-text-muted" />}
        review
      >
        <p className="text-sm text-text-muted">
          {isCompany
            ? 'Review your saved details. Documents and team setup can wait until your dashboard.'
            : 'Please review your information before completing signup'}
        </p>
      </AuthHeader>

      <div className="space-y-4">
        <Section title="Personal information">
          {userProfile ? (
            <Rows>
              <Row label="Full name" inline>
                {userProfile.fullName}
              </Row>
              <Row label="Phone" inline>
                {formatPhoneWithCountryCode(userProfile.phoneCountryCode, userProfile.phoneNumber)}
              </Row>
              <Row label="Residential address" inline>
                <span className="whitespace-pre-wrap break-words">
                  {userProfile.residentialAddress || 'Not provided'}
                </span>
              </Row>
            </Rows>
          ) : (
            <p className="text-sm text-text-muted">No personal information found.</p>
          )}
        </Section>

        {isCompany ? (
          <Section title="Company information">
            {company ? (
              <Rows>
                <Row label="Company name" inline>
                  {company.name}
                </Row>
                <Row label="ACN" inline>
                  {company.acn}
                </Row>
                {company.abn && (
                  <Row label="ABN" inline>
                    {company.abn}
                  </Row>
                )}
                <Row label="Type" inline>
                  {displayCompanyType(company.companyType)}
                </Row>
              </Rows>
            ) : (
              <p className="text-sm text-text-muted">No company information found.</p>
            )}
          </Section>
        ) : (
          <Section title="Financial profile">
            {financialProfile ? (
              <Rows>
                <Row label="Source of funds" inline>
                  {formatSourceOfFunds(financialProfile.sourceOfFunds)}
                </Row>
                {financialProfile.sourceOfFundsOtherText && (
                  <Row label="Source (Other)" inline>
                    {financialProfile.sourceOfFundsOtherText}
                  </Row>
                )}
                {financialProfile.intendedUse && (
                  <Row label="Intended use" inline>
                    {formatIntendedUse(financialProfile.intendedUse)}
                  </Row>
                )}
                {financialProfile.intendedUseOtherText && (
                  <Row label="Intended use (Other)" inline>
                    {financialProfile.intendedUseOtherText}
                  </Row>
                )}
                {financialProfile.occupation && (
                  <Row label="Occupation" inline>
                    {financialProfile.occupation}
                  </Row>
                )}
              </Rows>
            ) : (
              <p className="text-sm text-text-muted">No financial profile found.</p>
            )}
          </Section>
        )}

        <div className="rounded-xl border border-border bg-surface-raised p-4 sm:p-5">
          {isCompany && company ? (
            <div className="space-y-3 mb-4 text-sm text-text-body">
              <p className="leading-relaxed">
                By completing setup, you confirm that you are authorised to administer {company.name}, including
                managing its users, and accept the{' '}
                <a
                  href={`${SITE_URL}${SITE_PATHS.termsOfService}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-light hover:text-brand-subtle underline"
                >
                  Terms of Service
                </a>{' '}
                on the company’s behalf.
              </p>
              {authorityError && (
                <div role="alert" className="space-y-2 text-error-light">
                  <p>{authorityError}</p>
                  {authorityRequest?.status === 'pending' && (
                    <button
                      type="button"
                      disabled={isSubmitting || isResettingAuthority}
                      onClick={() => void resetAuthorityRequest().catch(() => undefined)}
                      className="font-semibold underline disabled:opacity-50"
                    >
                      Update saved setup
                    </button>
                  )}
                  <button type="button" onClick={() => void retryLoad()} className="font-semibold underline">
                    Refresh company setup
                  </button>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-text-body leading-relaxed mb-4">
              By completing signup, you accept the{' '}
              <a
                href={`${SITE_URL}${SITE_PATHS.termsOfService}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-light hover:text-brand-subtle underline"
              >
                Terms of Service
              </a>{' '}
              and{' '}
              <a
                href={`${SITE_URL}${SITE_PATHS.privacyPolicy}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-light hover:text-brand-subtle underline"
              >
                Privacy Policy
              </a>
              .
            </p>
          )}
          {identityRequired ? (
            <p className="text-sm text-text-body text-center mb-4">
              This platform requires a verified identity before company setup.{' '}
              <button
                type="button"
                onClick={() => setVerificationOpen(true)}
                className="font-semibold text-brand-light hover:text-brand-subtle underline"
              >
                Verify your identity
              </button>
            </p>
          ) : (
            !canCompleteSignup && (
              <p className="text-sm text-error-light text-center mb-4">
                Please ensure all information is complete to proceed.
              </p>
            )
          )}
          {completionError && (
            <p role="alert" className="text-sm text-error-light text-center mb-4">
              {completionError}
            </p>
          )}
          <AuthSubmit
            busy={isSubmitting}
            busyLabel="Completing…"
            disabled={!canCompleteSignup || isSubmitting || isResettingAuthority}
            type="button"
            onClick={() => void completeSignup().catch(() => undefined)}
          >
            {isCompany ? 'Complete company setup' : 'Complete signup'}
          </AuthSubmit>
        </div>
      </div>

      <AuthDivider />

      <div className="text-center">
        <p className="text-sm text-text-subtle">
          <AuthBack onClick={handleBack} disabled={isSubmitting || isResettingAuthority} />
        </p>
      </div>

      {identityRequired && (
        <IdentityVerificationModal
          isOpen={verificationOpen}
          onClose={() => {
            setVerificationOpen(false);
            void retryLoad();
          }}
        />
      )}
    </AuthLayout>
  );
}
