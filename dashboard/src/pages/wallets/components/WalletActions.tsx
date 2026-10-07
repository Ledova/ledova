import { PageAction } from '@components/Page';

interface WalletActionsProps {
  label: string;
  canVerify: boolean;
  refreshProof?: boolean;
  canDerive: boolean;
  syncing: boolean;
  syncDisabled: boolean;
  onEdit: () => void;
  onVerify: () => void;
  onDerive: () => void;
  onSync: () => void;
  onDelete: () => void;
}

export function WalletActions({
  label,
  canVerify,
  refreshProof = false,
  canDerive,
  syncing,
  syncDisabled,
  onEdit,
  onVerify,
  onDerive,
  onSync,
  onDelete,
}: WalletActionsProps) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2">
      <PageAction label="Edit" onClick={onEdit} />
      {canVerify && <PageAction label={refreshProof ? 'Refresh possession proof' : 'Verify'} onClick={onVerify} />}
      {canDerive && <PageAction label="Derive address" onClick={onDerive} />}
      <PageAction label={syncing ? 'Syncing…' : 'Sync'} onClick={onSync} disabled={syncDisabled} />
      <PageAction label="Delete" onClick={onDelete} />
    </div>
  );
}
