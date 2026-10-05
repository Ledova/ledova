import { REGISTER_RECONCILIATION_COPY } from '../constants';
import type { OwnCompanyAppointment, RegisterAcknowledgeRequest, RegisterReconciliation } from '../types';
import { appointmentForRegisterStep } from './register-commands';

const DISCREPANCY_TEXT = ['transaction', 'member', 'address', 'chain', 'expected', 'effect', 'source', 'detail'];

function isAcknowledgement(value: unknown) {
  if (value === null) return true;
  const row = value as Record<string, unknown> | undefined;
  return (
    !!row &&
    ['reason', 'acknowledgedAt', 'providedBy'].every((key) => typeof row[key] === 'string') &&
    ['appointment', 'acknowledgedByName'].every((key) => row[key] === null || typeof row[key] === 'string')
  );
}

function isDiscrepancy(value: unknown) {
  const row = value as Record<string, unknown> | null | undefined;
  return (
    !!row &&
    typeof row.kind === 'string' &&
    typeof row.acknowledgeable === 'boolean' &&
    (row.block === undefined || typeof row.block === 'number') &&
    DISCREPANCY_TEXT.every((key) => row[key] === undefined || typeof row[key] === 'string') &&
    isAcknowledgement(row.acknowledgement)
  );
}

export function registerReconciliationOf(record: RegisterReconciliation): RegisterReconciliation {
  if (!Array.isArray(record.discrepancies) || !record.discrepancies.every(isDiscrepancy))
    throw new Error(REGISTER_RECONCILIATION_COPY.UNREADABLE);
  return record;
}

export function appointmentForAcknowledgement(appointments: OwnCompanyAppointment[], company: string) {
  return appointmentForRegisterStep(appointments, company, 'approve');
}

export function isDiscrepancyAcknowledgementReceipt(
  reconciliation: RegisterReconciliation,
  uuid: string,
  request: RegisterAcknowledgeRequest,
) {
  const acknowledgement = reconciliation.discrepancies[request.discrepancy]?.acknowledgement;
  return (
    reconciliation.uuid === uuid &&
    !!acknowledgement &&
    acknowledgement.reason === request.reason &&
    acknowledgement.appointment === request.appointment &&
    acknowledgement.providedBy === 'company'
  );
}
