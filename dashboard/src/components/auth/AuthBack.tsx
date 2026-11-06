import { AUTH_LINK_CLASS } from './classes';

export function AuthBack({ onClick, disabled = false }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={AUTH_LINK_CLASS}>
      Go back
    </button>
  );
}
