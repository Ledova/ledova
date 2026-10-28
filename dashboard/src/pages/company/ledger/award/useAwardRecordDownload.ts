import { useLayoutEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  downloadRegisterAwardFile,
  downloadRegisterAwardVestingFile,
  downloadRegisterAwardEndFile,
  downloadRegisterAwardVestingReversalFile,
  type OrderSubmissionOwner,
  type RegisterAward,
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
} from '@pages/company/ledger/shared/useRegisterAwards';
import { ownAppointmentsKey } from '@hooks/useOwnAppointments';
import { saveFile } from '@utils/saveFile';

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
          [...awardsKey(owner, award.token), award.uuid],
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
