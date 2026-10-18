import type { ReactElement } from 'react';
import { Route } from 'react-router-dom';

import { SignupRoute } from './SignupRoute';
import { SIGNUP_STEPS, type SignupStep } from '@utils/paths';

export function signupRoutes(steps: Record<SignupStep, ReactElement>) {
  return (
    <Route element={<SignupRoute />}>
      {SIGNUP_STEPS.map((path) => (
        <Route key={path} path={path} element={steps[path]} />
      ))}
    </Route>
  );
}
