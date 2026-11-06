import type { ReactNode } from 'react';
import { WarningIcon } from '@phosphor-icons/react';
import { Failure } from '@components/Ledger';
import { ICON_MD } from '@components/iconSizes';
import { ERROR_BANNER_CLASS } from './classes';

export function AuthAlert({ children }: { children: ReactNode }) {
  return (
    <div className={ERROR_BANNER_CLASS}>
      <div className="flex items-start">
        <div className="flex-shrink-0">
          <WarningIcon size={ICON_MD} className="text-error-light" />
        </div>
        <div className="ml-3">
          <Failure>{children}</Failure>
        </div>
      </div>
    </div>
  );
}
