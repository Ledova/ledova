// @vitest-environment jsdom

import { COMPANY_ENDPOINTS, COMPANY_TOKEN_ENDPOINTS, USER_PREFERENCES_QUERY_KEY } from '@ledova/shared';
import { QueryClient } from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { OUTPUT_APPOINTMENT, OUTPUT_ENTRY, OUTPUT_PREVIEW, OUTPUT_REGISTER } from '../../../testSupport/company';
import { prepareCompanyClient, renderCompanyPage } from '../../../testSupport/company';
import { ClassCertificate } from './ClassCertificate';
import { CompanyPack } from './CompanyPack';

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
  fireEvent.change(certificateControls.getByLabelText('Instruction reference'), {
    target: { value: 'Synthetic certificate instruction' },
  });
  fireEvent.submit(certificateForm);
  await certificateControls.findByRole('button', { name: `Download PDF (${certificateContext})` });
  expect(api.post).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.submit(certificateForm);
  });
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(certificateControls.getByRole('button', { name: `Edit (${certificateContext})` }));
  fireEvent.click(certificateControls.getByRole('button', { name: `Preview (${certificateContext})` }));
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
      instruction: 'Synthetic certificate instruction',
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
});
