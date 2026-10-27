// @vitest-environment jsdom

import { COMPANY_ENDPOINTS, COMPANY_TOKEN_ENDPOINTS, USER_PREFERENCES_QUERY_KEY } from '@ledova/shared';
import { QueryClient } from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { OUTPUT_APPOINTMENT, OUTPUT_ENTRY, OUTPUT_PREVIEW, OUTPUT_REGISTER } from '../../../testSupport/company';
import {
  MEMBER_RECORD,
  MEMBER_ENTRY,
  FULFILLED_CERTIFICATE,
  prepareCompanyClient,
  renderCompanyPage,
} from '../../../testSupport/company';
import { ClassCertificate } from '../../documents/certificates/ClassCertificate';
import { CompanyPack } from './CompanyPack';
import CertificatesPage from '../../documents/certificates';
import { CompanyContext, type CompanyContextValue } from '@hooks/useCompanyContext';
import { MemberRecordsProvider } from '@components/member-records/MemberRecordsProvider';
import { CERTIFICATES_PATH } from '@utils/paths';
import { registerKey } from '@hooks/useRegisterAccess';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
let release: (() => void) | undefined;
afterEach(async () => {
  await act(async () => release?.());
  release = undefined;
  cleanup();
  client.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('downloads exact unsigned outputs and refuses late files after source or current account read loss', async () => {
  prepareCompanyClient(client);
  const certificate = COMPANY_TOKEN_ENDPOINTS.REGISTER_CERTIFICATE(OUTPUT_REGISTER.token.uuid);
  const pack = COMPANY_ENDPOINTS.PACK(OUTPUT_APPOINTMENT.company);
  const pdf = new Blob(['%PDF synthetic unsigned'], { type: 'application/pdf' });
  const zip = new Blob(['PK synthetic archive'], { type: 'application/zip' });
  const createObjectURL = vi.fn(() => 'blob:synthetic');
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  api.get.mockReset().mockImplementation(async (url) => {
    if (url === '/api/v1/company-authority/appointments/')
      return { data: { results: [OUTPUT_APPOINTMENT], next: null } };
    if (url === certificate) return { data: OUTPUT_PREVIEW };
    throw new Error(`Unexpected GET ${url}`);
  });
  api.post.mockReset().mockImplementation(async (url) => ({ data: url === certificate ? pdf : zip }));
  function Outputs() {
    const [certificateReady, setCertificateReady] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setCertificateReady(false)}>
          Hide certificate task
        </button>
        <ClassCertificate
          sourceKey="synthetic"
          register={OUTPUT_REGISTER}
          entry={OUTPUT_ENTRY}
          guard={() => {}}
          sourceReady={certificateReady}
        />
        <CompanyPack
          owner={{ userUuid: 'profile-one', ownerAccountUuid: 'account-one' }}
          guard={() => {}}
          company={OUTPUT_APPOINTMENT.company}
          sourceReady
        />
      </>
    );
  }
  renderCompanyPage(client, <Outputs />, 'Register outputs');
  const certificateContext = `unsigned certificate for entry ${OUTPUT_ENTRY.sequence}`;
  fireEvent.click(screen.getByRole('button', { name: /Prepare unsigned certificate/ }));
  fireEvent.click(screen.getByRole('button', { name: `Cancel (${certificateContext})` }));
  expect(screen.queryByRole('form', { name: `Unsigned certificate for entry ${OUTPUT_ENTRY.sequence}` })).toBeNull();
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /Prepare unsigned certificate/ }));
  const certificateForm = screen.getByRole('form', {
    name: `Unsigned certificate for entry ${OUTPUT_ENTRY.sequence}`,
  });
  const certificateControls = within(certificateForm);
  expect(certificateControls.queryByRole('textbox')).toBeNull();
  fireEvent.submit(certificateForm);
  await certificateControls.findByRole('button', { name: `Download PDF (${certificateContext})` });
  expect(api.post).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.submit(certificateForm);
  });
  expect(api.post).not.toHaveBeenCalled();
  expect(certificateControls.queryByRole('button', { name: `Edit (${certificateContext})` })).toBeNull();
  const download = await certificateControls.findByRole('button', { name: `Download PDF (${certificateContext})` });
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(download);
  await waitFor(() => expect(createObjectURL).toHaveBeenCalledWith(pdf));
  expect(api.post).toHaveBeenCalledWith(
    certificate,
    {
      sequence: OUTPUT_ENTRY.sequence,
      appointment: OUTPUT_APPOINTMENT.uuid,
      sourceDigest: OUTPUT_PREVIEW.sourceDigest,
    },
    expect.objectContaining({ responseType: 'blob', ledovaSubmissionGuard: expect.any(Function) }),
  );
  api.post.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = () => resolve({ data: pdf });
      }),
  );
  fireEvent.click(certificateControls.getByRole('button', { name: `Preview (${certificateContext})` }));
  fireEvent.click(await certificateControls.findByRole('button', { name: `Download PDF (${certificateContext})` }));
  await waitFor(() => expect(release).toBeTypeOf('function'));
  const certificateSignal = api.post.mock.calls.at(-1)![2].signal as AbortSignal;
  fireEvent.click(screen.getByRole('button', { name: 'Hide certificate task' }));
  expect(certificateSignal.aborted).toBe(true);
  expect(screen.queryByLabelText('Instruction reference')).toBeNull();
  expect(screen.getByRole('button', { name: /Prepare unsigned certificate/ }).matches(':disabled')).toBe(true);
  await act(async () => release!());
  release = undefined;
  expect(createObjectURL).toHaveBeenCalledTimes(1);
  fireEvent.click(await screen.findByRole('button', { name: 'Prepare company pack' }));
  expect(screen.queryByRole('button', { name: 'Refresh pack appointment' })).toBeNull();
  fireEvent.change(await screen.findByLabelText('Pack instruction reference'), {
    target: { value: 'Synthetic pack instruction' },
  });
  fireEvent.change(screen.getByLabelText('Pack recipient'), { target: { value: 'Synthetic recipient' } });
  fireEvent.click(screen.getByRole('button', { name: 'Prepare and download company pack' }));
  await waitFor(() => expect(createObjectURL).toHaveBeenCalledWith(zip));
  expect(api.post).toHaveBeenCalledWith(
    pack,
    {
      appointment: OUTPUT_APPOINTMENT.uuid,
      instruction: 'Synthetic pack instruction',
      recipient: 'Synthetic recipient',
    },
    expect.objectContaining({ responseType: 'blob', ledovaSubmissionGuard: expect.any(Function) }),
  );
  api.post.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = () => resolve({ data: zip });
      }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Prepare and download company pack' }));
  await waitFor(() => expect(release).toBeTypeOf('function'));
  await act(async () => {
    await client
      .fetchQuery({
        queryKey: USER_PREFERENCES_QUERY_KEY,
        queryFn: async () => {
          throw new Error('Current preferences refused');
        },
        retry: false,
      })
      .catch(() => {});
  });
  await act(async () => release!());
  await screen.findByRole('alert');
  expect(createObjectURL).toHaveBeenCalledTimes(2);
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
  prepareCompanyClient(client);
  let refusedHistory = false;
  let refusedMore = true;
  const otherEntry = {
    ...OUTPUT_ENTRY,
    uuid: '55555555-5555-4555-8555-555555555555',
    sequence: 2,
    changes: [{ member: '66666666-6666-4666-8666-666666666666', name: 'Other shareholder', shares: '20' }],
  };
  const page = (results: unknown[], next: string | null = null) => ({ data: { results, next, count: results.length } });
  api.get.mockImplementation(async (url, config) => {
    if (url === '/api/v1/company-authority/appointments/') return page([OUTPUT_APPOINTMENT]);
    if (url === COMPANY_TOKEN_ENDPOINTS.REGISTER)
      return page([
        { ...OUTPUT_REGISTER.token, companyUuid: MEMBER_RECORD.company.uuid, companyName: MEMBER_RECORD.company.name },
      ]);
    if (url === COMPANY_TOKEN_ENDPOINTS.HOLDERS(OUTPUT_REGISTER.token.uuid)) return { data: OUTPUT_REGISTER };
    if (url === COMPANY_TOKEN_ENDPOINTS.REGISTER_ENTRIES(OUTPUT_REGISTER.token.uuid)) {
      if (refusedHistory || (config.params.page === 2 && refusedMore)) throw new Error('Synthetic history refusal');
      return page(
        [OUTPUT_ENTRY, otherEntry],
        config.params.page === 1 ? 'https://example.invalid/entries?page=2' : null,
      );
    }
    if (url === COMPANY_TOKEN_ENDPOINTS.MEMBER_RECORDS) return page([MEMBER_RECORD]);
    if (url === COMPANY_TOKEN_ENDPOINTS.MEMBER_RECORD(MEMBER_RECORD.uuid)) return { data: MEMBER_RECORD };
    if (url === COMPANY_TOKEN_ENDPOINTS.MEMBER_ENTRIES(MEMBER_RECORD.uuid))
      return { data: { entries: [MEMBER_ENTRY] } };
    if (url === COMPANY_TOKEN_ENDPOINTS.MEMBER_PARTICULARS_REQUESTS) return page([]);
    if (url === COMPANY_TOKEN_ENDPOINTS.MEMBER_CERTIFICATE_REQUESTS) return page([FULFILLED_CERTIFICATE]);
    throw new Error(`Unexpected certificate read ${url}`);
  });
  const company = {
    uuid: MEMBER_RECORD.company.uuid,
    name: MEMBER_RECORD.company.name,
    memberUuids: [MEMBER_RECORD.uuid],
    canReadRegister: true,
    canManage: true,
    canReviewEligibility: false,
    isOwner: false,
  };
  const context: CompanyContextValue = {
    company,
    companyUuid: company.uuid,
    companyPath: (path) => path,
    selectCompany: () => false,
    openDashboard: () => false,
    directory: {
      owner: { userUuid: 'profile-one', ownerAccountUuid: 'account-one' },
      companies: [company],
      members: [MEMBER_RECORD],
      isLoading: false,
      isRefreshing: false,
      hasError: false,
      retry: async () => {},
    },
  };
  renderCompanyPage(
    client,
    <MemberRecordsProvider>
      <CompanyContext.Provider value={context}>
        <CertificatesPage />
      </CompanyContext.Provider>
    </MemberRecordsProvider>,
    'Certificates',
    {
      path: CERTIFICATES_PATH,
      entry: `${CERTIFICATES_PATH}?company=${company.uuid}&class=${OUTPUT_REGISTER.token.uuid}`,
    },
  );
  const records = await screen.findByRole('list', { name: 'Certificate records' });
  await waitFor(() => expect(within(records).getAllByRole('listitem')).toHaveLength(2));
  expect(within(records).queryByText('You')).toBeNull();
  expect(within(records).getAllByText(MEMBER_RECORD.name)).toHaveLength(1);
  expect(within(records).getByText('Other shareholder')).toBeTruthy();
  expect(within(records).getByText('Fulfilled', { exact: true })).toBeTruthy();
  expect(within(records).queryByRole('button', { name: /Prepare unsigned certificate/ })).toBeNull();
  fireEvent.click(within(records).getByRole('button', { name: new RegExp(MEMBER_RECORD.name) }));
  expect(within(records).getByRole('button', { name: /Prepare unsigned certificate/ })).toBeTruthy();
  expect(within(records).getAllByRole('button', { name: /Prepare unsigned certificate/, hidden: true })).toHaveLength(
    2,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Load more register entries' }));
  await waitFor(() => expect(client.isFetching()).toBe(0));
  await screen.findByText('More register entries could not be loaded. The list is incomplete.');
  expect(within(records).getAllByRole('listitem')).toHaveLength(2);
  expect(
    within(records)
      .getAllByRole('button', { name: /Prepare unsigned certificate/, hidden: true })
      .every((button) => (button as HTMLButtonElement).disabled),
  ).toBe(true);
  refusedMore = false;
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() =>
    expect(
      within(records)
        .getAllByRole('button', { name: /Prepare unsigned certificate/, hidden: true })
        .every((button) => !(button as HTMLButtonElement).disabled),
    ).toBe(true),
  );
  refusedHistory = true;
  await act(async () => {
    await client.refetchQueries({
      queryKey: [
        ...registerKey({ userUuid: 'profile-one', ownerAccountUuid: 'account-one' }),
        'entries',
        OUTPUT_REGISTER.token.uuid,
      ],
      exact: true,
    });
  });
  await screen.findByText('Certificate records could not be loaded.');
  expect(screen.queryByText('Other shareholder')).toBeNull();
  expect(screen.queryByText(MEMBER_RECORD.name)).toBeNull();
  expect(screen.queryByRole('button', { name: /Request certificate/ })).toBeNull();
});
