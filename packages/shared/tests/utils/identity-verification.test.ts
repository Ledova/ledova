import type { IdentityVerificationStatus } from '../../src/types';
import { readIdentityVerification } from '../../src/utils/identity-verification';

function status(overrides: Partial<IdentityVerificationStatus> = {}): IdentityVerificationStatus {
  return {
    applicantId: null,
    extractedData: null,
    isVerified: false,
    needsRetry: false,
    provider: 'synthetic',
    rejectionLabels: [],
    reviewAnswer: null,
    reviewResult: null,
    status: 'init',
    verifiedAt: null,
    ...overrides,
  };
}

const NOT_STARTED = {
  isVerified: false,
  needsRetry: false,
  hasApplicant: false,
  isPending: false,
  isOnHold: false,
  isRejected: false,
  hasSubmitted: false,
  showPendingBanner: false,
  showOnHoldBanner: false,
  showRejectedBanner: false,
  showRetryBanner: false,
  showForm: true,
  showContinue: false,
  showSkip: true,
};

const SUBMITTED = { showPendingBanner: true, showForm: false, showContinue: true, showSkip: false };

it.each([
  ['unread', undefined, false, {}],
  ['unread, just submitted', undefined, true, SUBMITTED],
  ['not started', status(), false, {}],
  ['started with an applicant', status({ applicantId: 'applicant' }), false, { hasApplicant: true }],
  ['pending', status({ status: 'pending' }), false, { isPending: true, hasSubmitted: true, ...SUBMITTED }],
  ['queued', status({ status: 'queued' }), false, { isPending: true, hasSubmitted: true, ...SUBMITTED }],
  [
    'on hold',
    status({ status: 'onHold' }),
    false,
    { isOnHold: true, hasSubmitted: true, showOnHoldBanner: true, ...SUBMITTED },
  ],
  ['on hold, just submitted', status({ status: 'onHold' }), true, { isOnHold: true, hasSubmitted: true, ...SUBMITTED }],
  [
    'verified',
    status({ status: 'completed', reviewAnswer: 'GREEN', isVerified: true }),
    false,
    { isVerified: true, showForm: false, showContinue: true, showSkip: false },
  ],
  [
    'verified while the provider still says pending',
    status({ status: 'pending', isVerified: true }),
    false,
    { isVerified: true, showForm: false, showContinue: true, showSkip: false },
  ],
  [
    'finally refused',
    status({ status: 'completed', reviewAnswer: 'RED' }),
    false,
    { isRejected: true, showRejectedBanner: true },
  ],
  [
    'finally refused, just submitted',
    status({ status: 'completed', reviewAnswer: 'RED' }),
    true,
    { isRejected: true, showForm: true, showContinue: true, showSkip: false },
  ],
  [
    'refused with a retry allowed',
    status({ status: 'completed', reviewAnswer: 'RED', needsRetry: true }),
    false,
    { needsRetry: true, showRetryBanner: true, showForm: false },
  ],
  [
    'refused with a retry allowed, just submitted',
    status({ status: 'completed', reviewAnswer: 'RED', needsRetry: true }),
    true,
    { needsRetry: true, ...SUBMITTED },
  ],
] as const)('reads a check that is %s', (_, current, justSubmitted, expected) => {
  expect(readIdentityVerification(current, justSubmitted)).toEqual({ ...NOT_STARTED, ...expected });
});
