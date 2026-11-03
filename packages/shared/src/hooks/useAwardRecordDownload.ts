import { useLayoutEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  downloadRegisterAwardEndFile,
  downloadRegisterAwardFile,
  downloadRegisterAwardVestingFile,
  downloadRegisterAwardVestingReversalFile,
} from '../services/register-awards';
import type { RegisterAward } from '../types';
import { downloadedFile, retainedName, type FileDelivery } from '../utils/downloads';
import { useApiClient } from './useApiClient';
import { ownAppointmentsKey } from './useOwnAppointments';
import {
  awardEndsKey,
  awardVestingReversalsKey,
  awardVestingsKey,
  awardsKey,
  type useRegisterAwardEnds,
  type useRegisterAwardVestingReversals,
  type useRegisterAwardVestings,
} from './useRegisterAwards';
import type { OrderSubmissionOwner, OrderSubmissionSession } from './useSubmissionOwner';

export function useAwardRecordDownload(
  owner: OrderSubmissionOwner,
  award: RegisterAward,
  guard: () => void,
  blocked: boolean,
  visible: boolean,
  events: ReturnType<typeof useRegisterAwardVestings>,
  ends: ReturnType<typeof useRegisterAwardEnds>,
  reversals: ReturnType<typeof useRegisterAwardVestingReversals>,
  files: FileDelivery,
  session?: OrderSubmissionSession,
) {
  const apiClient = useApiClient();
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
      const config = {
        ...session?.requestConfig(),
        ...(files.responseType ? { responseType: files.responseType } : {}),
        ledovaSubmissionGuard: check,
      };
      const response =
        event?.kind === 'vesting'
          ? await downloadRegisterAwardVestingFile(apiClient, event.uuid, config)
          : event?.kind === 'end'
            ? await downloadRegisterAwardEndFile(apiClient, event.uuid, config)
            : event?.kind === 'reversal'
              ? await downloadRegisterAwardVestingReversalFile(apiClient, event.uuid, config)
              : await downloadRegisterAwardFile(apiClient, award.uuid, config);
      check();
      const file = downloadedFile(response);
      if (!file) throw new Error('The retained document could not be read.');
      const snapshot =
        event?.kind === 'vesting'
          ? events.data?.find((row) => row.uuid === event.uuid)?.evidenceSnapshot
          : event?.kind === 'end'
            ? ends.data?.find((row) => row.uuid === event.uuid)?.evidenceSnapshot
            : event?.kind === 'reversal'
              ? reversals.data?.find((row) => row.uuid === event.uuid)?.evidenceSnapshot
              : award.agreementSnapshot;
      await files.save(file.data, retainedName(snapshot, `award-${event?.uuid || award.uuid}`), file.type);
    },
  });
}
