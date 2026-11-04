import type { useCompanyTeam } from '@ledova/shared';
import { Modal } from '@components/Modal';

export function RevokeAppointmentDialog({
  team: { confirmation, close, revoking, disabled, canRevoke, ticket, revoke },
}: {
  team: ReturnType<typeof useCompanyTeam>;
}) {
  return (
    <Modal
      isOpen={!!confirmation}
      onClose={close}
      title="Revoke appointment permanently?"
      showFooter
      confirmLabel="Permanently revoke appointment"
      destructive
      busy={revoking}
      busyLabel="Revoking…"
      confirmDisabled={!confirmation || disabled || !canRevoke(confirmation.appointment)}
      onConfirm={() => {
        if (!confirmation || ticket.current !== confirmation.ticket || disabled || !canRevoke(confirmation.appointment))
          return;
        void revoke(confirmation.appointment).finally(close);
      }}
    >
      <p className="text-sm text-text-primary">
        Permanently remove{' '}
        {confirmation && 'name' in confirmation.appointment
          ? `${confirmation.appointment.name || confirmation.appointment.email}'s appointment`
          : 'your appointment'}{' '}
        for {confirmation?.companyName}? This appointment loses its company authority. Its history remains retained.
        {confirmation?.appointment.source !== 'invitation' &&
          ' Another initial self-declaration cannot restore it; revoking an initial or legacy-owner appointment does not reopen admission.'}
      </p>
    </Modal>
  );
}
