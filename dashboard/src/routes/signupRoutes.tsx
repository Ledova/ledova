import type { ReactElement } from 'react';
import { Route } from 'react-router-dom';

import { SignupRoute } from './SignupRoute';

export const SIGNUP_STEPS = [
  '/signup/email-confirmation',
  '/signup/account-type',
  '/signup/pre-screening',
  '/signup/identity-verification',
  '/signup/user-profile',
  '/signup/financial-profile',
  '/signup/company-registration',
  '/signup/review',
] as const;

export type SignupStep = (typeof SIGNUP_STEPS)[number];

export const SIGNUP_RESUMES_AT: SignupStep = '/signup/account-type';

export function signupRoutes(steps: Record<SignupStep, ReactElement>) {
  return (
    <Route element={<SignupRoute />}>
      {SIGNUP_STEPS.map((path) => (
        <Route key={path} path={path} element={steps[path]} />
      ))}
    </Route>
  );
}
