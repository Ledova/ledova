import type { MouseEventHandler, ReactNode } from 'react';
import { AUTH_BUTTON_CLASS } from './classes';

export function AuthSubmit({
  busy,
  busyLabel,
  disabled = busy,
  type = 'submit',
  onClick,
  children,
}: {
  busy: boolean;
  busyLabel: string;
  disabled?: boolean;
  type?: 'submit' | 'button';
  onClick?: MouseEventHandler<HTMLButtonElement>;
  children: ReactNode;
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={AUTH_BUTTON_CLASS}>
      {busy ? (
        <div className="flex items-center justify-center space-x-2">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
          <span>{busyLabel}</span>
        </div>
      ) : (
        children
      )}
    </button>
  );
}
