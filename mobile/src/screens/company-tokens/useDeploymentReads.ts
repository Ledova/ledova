import { useQuery } from '@tanstack/react-query';
import type { AxiosRequestConfig } from 'axios';
import {
  getOwnCompanyAppointments,
  getRegisterDeployments,
  readEveryPage,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';

type Owner = OrderSubmissionOwner | null | undefined;
type Read = {
  uuid: string;
  data: { epoch: number; owner: Owner };
  company: string | undefined;
  read: <Result>(request: () => Promise<Result>) => Promise<Result>;
  config: (signal?: AbortSignal) => AxiosRequestConfig;
};

function deploymentScope(epoch: number, owner: Owner, uuid: string) {
  return [epoch, owner?.userUuid, owner?.ownerAccountUuid, uuid];
}

export function registerDeploymentAppointmentsKey(epoch: number, owner: Owner, uuid: string) {
  return ['register-deployment-appointments', ...deploymentScope(epoch, owner, uuid)];
}

export function registerDeploymentsKey(epoch: number, owner: Owner, uuid: string) {
  return ['register-deployments', ...deploymentScope(epoch, owner, uuid)];
}

export function useDeploymentAppointments({ uuid, data, company, read, config }: Read) {
  const appointmentsKey = registerDeploymentAppointmentsKey(data.epoch, data.owner, uuid);
  const appointments = useQuery({
    queryKey: appointmentsKey,
    enabled: !!data.owner && !!company,
    queryFn: ({ signal }) =>
      readEveryPage((page) => read(() => getOwnCompanyAppointments(apiClient, page, config(signal)))),
  });
  return { appointmentsKey, appointments };
}

export function useDeploymentProposals({ uuid, data, company, read, config }: Read) {
  const proposalsKey = registerDeploymentsKey(data.epoch, data.owner, uuid);
  const proposals = useQuery({
    queryKey: proposalsKey,
    enabled: !!data.owner && !!company,
    queryFn: async ({ signal }) => {
      const rows = await readEveryPage((page) =>
        read(() => getRegisterDeployments(apiClient, { token: uuid, page }, config(signal))),
      );
      if (
        rows.some((row) => row.token !== uuid || row.company !== company) ||
        new Set(rows.map((row) => row.uuid)).size !== rows.length
      )
        throw new Error('The deployment records do not belong to this share class.');
      return rows;
    },
  });
  return { proposalsKey, proposals };
}
