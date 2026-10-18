import { useLayoutEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  downloadRegisterAllotmentFile,
  downloadRegisterAwardFile,
  downloadRegisterAwardVestingFile,
  downloadRegisterAwardEndFile,
  downloadRegisterAwardVestingReversalFile,
  downloadRegisterCorrectionFile,
  downloadRegisterGrantFile,
  downloadRegisterImportFile,
  downloadRegisterLinkFile,
  downloadRegisterOpeningFile,
  downloadRegisterParticularsChangeFile,
  downloadRegisterTransferFile,
  type OrderSubmissionOwner,
  type RegisterAllotment,
  type RegisterAward,
  type RegisterCorrection,
  type RegisterGrant,
  type RegisterImport,
  type RegisterLink,
  type RegisterOpening,
  type RegisterParticularsChange,
  type RegisterTransfer,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { retainedName } from '@pages/company/shared/proposals';
import {
  awardsKey,
  awardVestingsKey,
  awardEndsKey,
  awardVestingReversalsKey,
  type useRegisterAwardEnds,
  type useRegisterAwardVestingReversals,
  type useRegisterAwardVestings,
} from '@pages/company/register/shared/useRegisterAwards';
import { ownAppointmentsKey } from '@hooks/useOwnAppointments';
import { saveFile } from '@utils/saveFile';

export function useAllotmentRecordDownload(allotment: RegisterAllotment, guard: () => void) {
  return useMutation({
    mutationFn: async (kind: 'authority' | 'agreement' | 'receipt') => {
      guard();
      const { data } = await downloadRegisterAllotmentFile(apiClient, allotment.uuid, kind, {
        ledovaSubmissionGuard: guard,
      });
      guard();
      const snapshot =
        kind === 'authority'
          ? allotment.evidenceSnapshot
          : kind === 'agreement'
            ? allotment.agreement.evidenceSnapshot
            : allotment.contribution.evidenceSnapshot;
      saveFile(data, retainedName(snapshot, `${kind}-${allotment.uuid}`));
    },
  });
}

export function useAwardRecordDownload(
  owner: OrderSubmissionOwner,
  award: RegisterAward,
  guard: () => void,
  blocked: boolean,
  visible: boolean,
  events: ReturnType<typeof useRegisterAwardVestings>,
  ends: ReturnType<typeof useRegisterAwardEnds>,
  reversals: ReturnType<typeof useRegisterAwardVestingReversals>,
) {
  const client = useQueryClient();
  const latestReady = useRef({ blocked, visible });
  useLayoutEffect(() => {
    latestReady.current = { blocked, visible };
  }, [blocked, visible]);
  return useMutation({
    mutationFn: async (event?: { kind: 'vesting' | 'end' | 'reversal'; uuid: string }) => {
      const check = () => {
        guard();
        const keys = [
          awardsKey(owner, award.token),
          ownAppointmentsKey(owner),
          awardVestingsKey(owner, award.uuid),
          awardEndsKey(owner, award.uuid),
          awardVestingReversalsKey(owner, award.uuid),
        ];
        if (
          latestReady.current.blocked ||
          !latestReady.current.visible ||
          keys.some((key) => {
            const state = client.getQueryState(key);
            return state?.status !== 'success' || state.fetchStatus !== 'idle';
          })
        )
          throw new Error('Refresh the current award and its events before downloading evidence.');
      };
      check();
      const { data } =
        event?.kind === 'vesting'
          ? await downloadRegisterAwardVestingFile(apiClient, event.uuid, { ledovaSubmissionGuard: check })
          : event?.kind === 'end'
            ? await downloadRegisterAwardEndFile(apiClient, event.uuid, { ledovaSubmissionGuard: check })
            : event?.kind === 'reversal'
              ? await downloadRegisterAwardVestingReversalFile(apiClient, event.uuid, { ledovaSubmissionGuard: check })
              : await downloadRegisterAwardFile(apiClient, award.uuid, { ledovaSubmissionGuard: check });
      check();
      const snapshot =
        event?.kind === 'vesting'
          ? events.data?.find((row) => row.uuid === event.uuid)?.evidenceSnapshot
          : event?.kind === 'end'
            ? ends.data?.find((row) => row.uuid === event.uuid)?.evidenceSnapshot
            : event?.kind === 'reversal'
              ? reversals.data?.find((row) => row.uuid === event.uuid)?.evidenceSnapshot
              : award.agreementSnapshot;
      saveFile(data, retainedName(snapshot, `award-${event?.uuid || award.uuid}`));
    },
  });
}

export function useCorrectionRecordDownload(proposal: RegisterCorrection, check: () => void) {
  return useMutation({
    mutationFn: async () => {
      check();
      const { data } = await downloadRegisterCorrectionFile(apiClient, proposal.uuid, {
        ledovaSubmissionGuard: check,
      });
      check();
      saveFile(data, retainedName(proposal.evidenceSnapshot, `register-correction-${proposal.uuid}`));
    },
  });
}

export function useGrantRecordDownload(grant: RegisterGrant, guard: () => void) {
  return useMutation({
    mutationFn: async (kind: 'authority' | 'terms' | 'acceptance') => {
      guard();
      const { data } = await downloadRegisterGrantFile(apiClient, grant.uuid, kind, { ledovaSubmissionGuard: guard });
      guard();
      const snapshot =
        kind === 'authority'
          ? grant.evidenceSnapshot
          : kind === 'terms'
            ? grant.termsSnapshot
            : grant.acceptanceSnapshot;
      saveFile(data, retainedName(snapshot, `${kind}-${grant.uuid}`));
    },
  });
}

export function useImportRecordDownload(proposal: RegisterImport, check: () => void) {
  return useMutation({
    mutationFn: async (copy: 'register' | 'asic') => {
      check();
      const { data } = await downloadRegisterImportFile(apiClient, proposal.uuid, copy, {
        ledovaSubmissionGuard: check,
      });
      check();
      saveFile(
        data,
        copy === 'asic'
          ? retainedName(proposal.asicSnapshot, `asic-extract-${proposal.uuid}`)
          : retainedName(proposal.evidenceSnapshot, `register-import-${proposal.uuid}`),
      );
    },
  });
}

export function useLinkRecordDownload(link: RegisterLink, check: () => void) {
  return useMutation({
    mutationFn: async () => {
      check();
      const { data } = await downloadRegisterLinkFile(apiClient, link.uuid, { ledovaSubmissionGuard: check });
      check();
      saveFile(data, retainedName(link.evidenceSnapshot, `wallet-link-${link.uuid}`));
    },
  });
}

export function useOpeningRecordDownload(proposal: RegisterOpening, check: () => void) {
  return useMutation({
    mutationFn: async () => {
      check();
      const { data } = await downloadRegisterOpeningFile(apiClient, proposal.uuid, { ledovaSubmissionGuard: check });
      check();
      saveFile(data, retainedName(proposal.evidenceSnapshot, `register-opening-${proposal.uuid}`));
    },
  });
}

export function useParticularsRecordDownload(change: RegisterParticularsChange, check: () => void) {
  return useMutation({
    mutationFn: async () => {
      check();
      const { data } = await downloadRegisterParticularsChangeFile(apiClient, change.uuid, {
        ledovaSubmissionGuard: check,
      });
      check();
      saveFile(data, retainedName(change.evidenceSnapshot, `particulars-change-${change.uuid}`));
    },
  });
}

export function useTransferRecordDownload(transfer: RegisterTransfer, check: () => void) {
  return useMutation({
    mutationFn: async (kind: 'authority' | 'instrument') => {
      check();
      const { data } = await downloadRegisterTransferFile(apiClient, transfer.uuid, kind, {
        ledovaSubmissionGuard: check,
      });
      check();
      saveFile(
        data,
        retainedName(
          kind === 'authority' ? transfer.evidenceSnapshot : transfer.instrumentSnapshot,
          `${kind}-${transfer.uuid}`,
        ),
      );
    },
  });
}
