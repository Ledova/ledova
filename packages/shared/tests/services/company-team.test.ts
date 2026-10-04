import axios from 'axios';
import {
  acceptCompanyTeamInvitation,
  createCompanyTeamInvitation,
  getCompanyTeam,
  getCompanyTeamInvitations,
  getOwnCompanyAppointments,
  revokeCompanyAppointment,
} from '../../src/services/company-authority';

afterEach(() => jest.restoreAllMocks());

it('keeps the invitation code in the POST body with the current declaration and authenticated session scope', async () => {
  const api = axios.create();
  const post = jest.spyOn(api, 'post').mockResolvedValue({ data: { uuid: 'appointment-a' } });
  const config = { timeout: 1000, ledovaSessionEpoch: 4 };
  await acceptCompanyTeamInvitation(api, 'private-one-time-code', config);
  expect(post).toHaveBeenCalledWith(
    '/api/v1/company-authority/invitations/accept/',
    { code: 'private-one-time-code', declarationVersion: '2026-10-04', acceptDeclaration: true },
    config,
  );
  expect(post.mock.calls[0]![0]).not.toContain('private-one-time-code');
});

it('preserves issue idempotency and the truthful null code on an existing invitation response', async () => {
  const api = axios.create();
  const post = jest.spyOn(api, 'post').mockResolvedValue({ data: { uuid: 'invitation-a', code: null } });
  const data = {
    company: 'company-a',
    inviterAppointment: 'appointment-a',
    idempotencyKey: 'key-a',
    capabilities: ['prepare' as const],
    delegatableCapabilities: ['approve' as const],
  };
  const response = await createCompanyTeamInvitation(api, data);
  expect(post).toHaveBeenCalledWith('/api/v1/company-authority/invitations/', data, {});
  expect(response.data.code).toBeNull();
});

it('binds team reads to one company and revocation to one appointment without submitted actor or scope claims', async () => {
  const api = axios.create();
  const get = jest.spyOn(api, 'get').mockResolvedValue({ data: [] });
  const post = jest.spyOn(api, 'post').mockResolvedValue({ data: {} });
  const config = { timeout: 1000, ledovaSessionEpoch: 4 };
  await getCompanyTeam(api, 'company-a', config);
  await getOwnCompanyAppointments(api, 2, config);
  await getCompanyTeamInvitations(api, 3, config);
  await revokeCompanyAppointment(api, 'appointment-a', config);
  expect(get).toHaveBeenNthCalledWith(1, '/api/v1/company-authority/appointments/team/', {
    ...config,
    params: { company: 'company-a' },
  });
  expect(get).toHaveBeenNthCalledWith(2, '/api/v1/company-authority/appointments/', { ...config, params: { page: 2 } });
  expect(get).toHaveBeenNthCalledWith(3, '/api/v1/company-authority/invitations/', { ...config, params: { page: 3 } });
  expect(post).toHaveBeenCalledWith('/api/v1/company-authority/appointments/appointment-a/revoke/', {}, config);
});
