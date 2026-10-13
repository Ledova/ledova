import { useNavigate } from 'react-router-dom';

import { ClipboardTextIcon } from '@phosphor-icons/react';
import {
  formatPhoneWithCountryCode,
  getAddressDisplayLines,
  parseAddress,
  formatSourceOfFunds,
  formatIntendedUse,
  COMPANY_AUTHORITY_DECLARATION,
  COMPANY_AUTHORITY_DECLARATION_VERSION,
  COMPANY_AUTHORITY_CAPABILITIES,
} from '@ledova/shared';
import { ICON_LG } from '@components/iconSizes';
import { useReview } from './useReview';
import { AuthLayout } from '@components/AuthLayout';
import { Section } from '@components/Ledger';
import { COMPANY_TYPES } from '../company-registration/constants';
import { SITE_URL } from '@utils/siteUrl';
import { FIELD_CLASS } from '@components/fieldClass';

function displayCompanyType(companyType: string | undefined) {
  return COMPANY_TYPES.find((type) => type.value === companyType)?.label ?? companyType ?? '';
}

export function SignupReview() {
  const navigate = useNavigate();
  const {
    data,
    company,
    isCompany,
    isLoading,
    error,
    completionError,
    completeSignup,
    isSubmitting,
    canCompleteSignup,
    retryLoad,
    authorityRequest,
    authorityReady,
    authorityEvidenceLocked,
    authorityError,
    setAuthorityEvidence,
    authorityAccepted,
    setAuthorityAccepted,
    allowTeamDelegation,
    setAllowTeamDelegation,
    resetAuthorityRequest,
    isResettingAuthority,
  } = useReview();

  const handleBack = () => {
    if (isCompany) {
      navigate('/signup/company-registration');
    } else {
      navigate('/signup/financial-profile');
    }
  };

  if (isLoading) {
    return (
      <AuthLayout>
        <div className="flex flex-col items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand mb-4"></div>
          <p className="text-text-muted">Loading review data...</p>
        </div>
      </AuthLayout>
    );
  }

  if (error) {
    return (
      <AuthLayout>
        <div className="flex flex-col items-center justify-center py-8">
          <div className="text-center">
            <h3 className="text-lg font-medium text-error mb-2">Error Loading Data</h3>
            <p className="text-error">{error}</p>
            <button type="button" onClick={retryLoad} className="mt-4 font-semibold text-brand-light underline">
              Try Again
            </button>
          </div>
        </div>
      </AuthLayout>
    );
  }

  const { userProfile, financialProfile } = data;

  return (
    <AuthLayout>
      <div className="text-center mb-8">
        <div className="flex justify-center mb-4">
          <div className="p-3 rounded-full bg-surface-raised border border-border">
            <ClipboardTextIcon size={ICON_LG} className="text-text-muted" />
          </div>
        </div>
        <h1 className="mb-2 font-display text-3xl tracking-[-0.01em] text-text-primary">
          {isCompany ? 'Finish company setup' : 'Review & Confirm'}
        </h1>
        <p className="text-sm text-text-muted">
          {isCompany
            ? 'Your company details are saved. Confirm your authority to finish as its initial administrator.'
            : 'Please review your information before completing signup'}
        </p>
      </div>

      <div className="space-y-4">
        <Section title="Personal Information">
          {userProfile ? (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-text-muted">Full Name:</span>
                <span className="text-sm text-text-primary font-medium">{userProfile.fullName}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-text-muted">Phone:</span>
                <span className="text-sm text-text-primary font-medium">
                  {formatPhoneWithCountryCode(userProfile.phoneCountryCode, userProfile.phoneNumber)}
                </span>
              </div>
              {getAddressDisplayLines(parseAddress(userProfile.residentialAddress ?? '')).map((line, index) => (
                <div key={index} className="flex justify-between items-center">
                  <span className="text-sm text-text-muted">{line.label}</span>
                  <span className="text-sm text-text-primary font-medium">{line.value}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-error-light">No personal information found.</p>
          )}
        </Section>

        {isCompany ? (
          <Section title="Company Information">
            {company ? (
              <div className="space-y-4">
                <p className="text-sm text-text-muted">Company information is provided by the company.</p>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-muted">Company Name:</span>
                  <span className="text-sm text-text-primary font-medium">{company.name}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-muted">ACN:</span>
                  <span className="text-sm text-text-primary font-medium">{company.acn}</span>
                </div>
                {company.abn && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-text-muted">ABN:</span>
                    <span className="text-sm text-text-primary font-medium">{company.abn}</span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-muted">Type:</span>
                  <span className="text-sm text-text-primary font-medium">
                    {displayCompanyType(company.companyType)}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-error-light">No company information found.</p>
            )}
          </Section>
        ) : (
          <Section title="Financial Profile">
            {financialProfile ? (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-muted">Source of Funds:</span>
                  <span className="text-sm text-text-primary font-medium">
                    {formatSourceOfFunds(financialProfile.sourceOfFunds)}
                  </span>
                </div>
                {financialProfile.sourceOfFundsOtherText && (
                  <div className="flex justify-between items-start">
                    <span className="text-sm text-text-muted">Source (Other):</span>
                    <span className="text-sm text-text-primary font-medium text-right max-w-[200px]">
                      {financialProfile.sourceOfFundsOtherText}
                    </span>
                  </div>
                )}
                {financialProfile.intendedUse && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-text-muted">Intended Use:</span>
                    <span className="text-sm text-text-primary font-medium">
                      {formatIntendedUse(financialProfile.intendedUse)}
                    </span>
                  </div>
                )}
                {financialProfile.intendedUseOtherText && (
                  <div className="flex justify-between items-start">
                    <span className="text-sm text-text-muted">Intended Use (Other):</span>
                    <span className="text-sm text-text-primary font-medium text-right max-w-[200px]">
                      {financialProfile.intendedUseOtherText}
                    </span>
                  </div>
                )}
                {financialProfile.occupation && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-text-muted">Occupation:</span>
                    <span className="text-sm text-text-primary font-medium">{financialProfile.occupation}</span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-error-light">No financial profile found.</p>
            )}
          </Section>
        )}

        {isCompany && company && (
          <Section title="Your company authority">
            {authorityError && (
              <div role="alert" className="space-y-2 text-sm text-error-light">
                <p>{authorityError}</p>
                <button type="button" onClick={() => void retryLoad()} className="font-semibold underline">
                  Refresh company setup
                </button>
              </div>
            )}
            {authorityReady ? (
              <p role="status" className="text-sm text-text-primary">
                Your administrator access to {company.name} is established. Finish signup to open your workspace.
              </p>
            ) : (
              <div className="space-y-4 text-sm text-text-primary">
                {authorityRequest ? (
                  <div className="space-y-2">
                    <p>Saved supporting document: {authorityRequest.originalFilename}</p>
                    <p>
                      Your recorded actions:{' '}
                      {authorityRequest.requestedCapabilities
                        .map(
                          (capability) =>
                            COMPANY_AUTHORITY_CAPABILITIES.find((item) => item.value === capability)?.label,
                        )
                        .join(', ')}
                    </p>
                    <p>
                      Permission to delegate:{' '}
                      {authorityRequest.delegatableCapabilities
                        .map(
                          (capability) =>
                            COMPANY_AUTHORITY_CAPABILITIES.find((item) => item.value === capability)?.label,
                        )
                        .join(', ') || 'None'}
                    </p>
                    <button
                      type="button"
                      disabled={isSubmitting || isResettingAuthority}
                      onClick={() => void resetAuthorityRequest().catch(() => undefined)}
                      className="font-semibold text-brand-light underline disabled:opacity-50"
                    >
                      Use different evidence
                    </button>
                    <p className="text-text-muted">
                      Replacing a pending request retains its original evidence and history.
                    </p>
                  </div>
                ) : (
                  <>
                    <p>
                      You will administer this company and its register. Company decisions and share issues remain
                      separate actions.
                    </p>
                    <label className="block space-y-1">
                      Supporting document
                      <input
                        type="file"
                        accept="application/pdf,image/png,image/jpeg"
                        disabled={isSubmitting || authorityEvidenceLocked}
                        onChange={(event) => setAuthorityEvidence(event.target.files?.[0] ?? null)}
                        className={FIELD_CLASS}
                      />
                    </label>
                    <p className="text-text-muted">
                      PDF, PNG or JPEG, up to 10 MB, supporting your authority. This is Ledova&apos;s retained evidence
                      requirement; no ASIC extract is required.
                    </p>
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={allowTeamDelegation}
                        disabled={isSubmitting || authorityEvidenceLocked}
                        onChange={(event) => setAllowTeamDelegation(event.target.checked)}
                      />
                      Allow me to appoint company administrators
                    </label>
                    {authorityEvidenceLocked && (
                      <p role="status" className="text-text-muted">
                        The original upload is retained for retry. Reload your records before starting a different
                        request.
                      </p>
                    )}
                  </>
                )}
                <p>{COMPANY_AUTHORITY_DECLARATION}</p>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={authorityAccepted}
                    disabled={isSubmitting || isResettingAuthority}
                    onChange={(event) => setAuthorityAccepted(event.target.checked)}
                  />
                  I am authorised to administer {company.name} and accept this declaration.
                </label>
                <p className="text-text-muted">
                  Declaration {COMPANY_AUTHORITY_DECLARATION_VERSION}. Your required identity and company checks must
                  pass. This establishes access; it does not activate the company or approve a share issue.
                </p>
              </div>
            )}
          </Section>
        )}

        <div className="rounded-xl border border-border bg-surface-raised p-4 sm:p-5">
          <p className="text-sm text-text-body leading-relaxed mb-4">
            By completing signup, you accept the{' '}
            <a
              href={`${SITE_URL}/terms-of-service`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-light hover:text-brand-subtle underline"
            >
              Terms of Service
            </a>{' '}
            and{' '}
            <a
              href={`${SITE_URL}/privacy-policy`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-light hover:text-brand-subtle underline"
            >
              Privacy Policy
            </a>
            .
          </p>
          {!canCompleteSignup && (
            <p className="text-sm text-error-light text-center mb-4">
              Please ensure all information is complete to proceed.
            </p>
          )}
          {completionError && (
            <p role="alert" className="text-sm text-error-light text-center mb-4">
              {completionError}
            </p>
          )}
          <button
            type="button"
            onClick={() => void completeSignup().catch(() => undefined)}
            disabled={!canCompleteSignup || isSubmitting || isResettingAuthority}
            className="w-full bg-brand-mid hover:bg-brand disabled:bg-surface-disabled disabled:text-text-secondary disabled:cursor-not-allowed text-white font-semibold py-3 px-4 rounded-lg transition-colors shadow-lg shadow-brand-light/40 disabled:shadow-none focus:outline-none focus:ring-2 focus:ring-border-focus focus:ring-offset-2 focus:ring-offset-surface-base"
          >
            {isSubmitting ? (
              <div className="flex items-center justify-center space-x-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
                <span>Completing...</span>
              </div>
            ) : isCompany ? (
              'Complete company signup'
            ) : (
              'Complete Signup'
            )}
          </button>
        </div>
      </div>

      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border"></div>
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-4 bg-surface-base text-text-subtle font-medium">or</span>
        </div>
      </div>

      <div className="text-center">
        <p className="text-sm text-text-subtle">
          <button
            type="button"
            onClick={handleBack}
            disabled={isSubmitting}
            className="font-semibold text-brand-light hover:text-brand-subtle transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Go Back
          </button>
        </p>
      </div>
    </AuthLayout>
  );
}
