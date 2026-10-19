import type { ReactElement } from 'react';
import { Route } from 'react-router-dom';

import { SignupRoute } from './SignupRoute';
import { SIGNUP_PATH, SIGNUP_STEPS, type SignupStep } from '@utils/paths';

export function signupRoutes(start: ReactElement, steps: Record<SignupStep, ReactElement>) {
  return (
    <Route element={<SignupRoute />}>
      <Route path={SIGNUP_PATH} element={start} />
      {SIGNUP_STEPS.map((path) => (
        <Route key={path} path={path} element={steps[path]} />
      ))}
    </Route>
  );
}
