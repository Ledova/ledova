// @vitest-environment jsdom

import { Sidebar } from '@components/Sidebar';
import { LedgerNavigationProvider } from '@components/LedgerNavigationProvider';
import { ownAppointmentsKey } from '@hooks/useOwnAppointments';

import {
  COMPANY_TOKEN_ENDPOINTS as URLS,
  REGISTER_ALLOTMENT_COPY as COPY,
  REGISTER_TRANSFER_COPY as TRANSFER_COPY,
  UPLOAD_RULE,
  formatDate,
  type RegisterAllotment,
  type OwnCompanyAppointment,
} from '@ledova/shared';
import { QueryClient } from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { APPOINTMENT, REGISTER } from '../../../testSupport/company';
import { ALLOTMENT_REQUEST, allotmentFrom, allotmentDecision, allotmentPreview } from '../../../testSupport/company';
import CompanyRegisterPage from '.';
import { choose, companyPreferences, renderCompanyPage } from '../../../testSupport/company';

import { allotmentsKey } from './useRegisterAllotments';
import { TransferForm } from './transfer/TransferForm';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const save = vi.hoisted(() => vi.fn());
vi.mock('@services/apiClient', () => ({ default: api }));
vi.mock('@utils/saveFile', async (original) => ({ ...(await original<object>()), saveFile: save }));
const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
let pendingFileRelease: (() => void) | undefined;
let pendingReadRelease: (() => void) | undefined;

afterEach(async () => {
  await act(async () => {
    pendingFileRelease?.();
    pendingReadRelease?.();
  });
  pendingFileRelease = undefined;
  pendingReadRelease = undefined;
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

it('preserves original preparation and issue recovery through refresh, keeps approval separate and hides private records on failed source or authority reads', async () => {
  let rows: RegisterAllotment[] = [];
  let appointments: OwnCompanyAppointment[] = [APPOINTMENT];
  let failedRead = false;
  let interruptedAbsentPreparation = false;
  let absentPreparation: Record<string, unknown> | null = null;
  let pauseRead = false;
  let releaseRead: (() => void) | undefined;
  let releaseFile: (() => void) | undefined;
  let incompleteImpact = false;
  let staleApproval = true;
  let slowRegister = false;
  const preference = {
    ...REGISTER,
    token: { ...REGISTER.token, uuid: 'preference', name: 'Preference shares', symbol: 'PRF' },
  };
  const owner = { userUuid: 'profile-one', ownerAccountUuid: 'account-one' };
  const refreshAllotments = async () => {
    await act(async () => {
      await client.refetchQueries({ queryKey: ownAppointmentsKey(owner), exact: true });
    });
    act(() => {
      void client.refetchQueries({ queryKey: allotmentsKey(owner, REGISTER.token.uuid), exact: true });
    });
  };
  api.get.mockReset().mockImplementation(async (url, config?: { params?: { token?: string } }) => {
    if (url === '/api/user-accounts/') return { data: { uuid: 'account-one', role: 'company' } };
    if (url === '/api/user-profiles/' || url === '/api/feature-flags/') return { data: { results: [], next: null } };
    if (url === '/api/user-preferences/') {
      return { data: companyPreferences() };
    }
    if (url === URLS.REGISTER) {
      return {
        data: {
          results: [
            { uuid: REGISTER.token.uuid, companyUuid: APPOINTMENT.company, companyName: APPOINTMENT.companyName },
            { uuid: preference.token.uuid, companyUuid: APPOINTMENT.company, companyName: APPOINTMENT.companyName },
          ],
          next: null,
        },
      };
    }
    if (url === URLS.HOLDERS(REGISTER.token.uuid)) {
      if (slowRegister) await new Promise((resolve) => setTimeout(resolve, 40));
      return {
        data: rows[0]?.registerEntry
          ? {
              ...REGISTER,
              issuedSupply: rows[0].shares,
              totalHolders: 1,
              holders: [
                {
                  member: rows[0].member,
                  name: rows[0].name,
                  holderType: 'member',
                  balance: rows[0].shares,
                  shareClass: REGISTER.token.name,
                  source: 'register',
                  identitySource: 'company_recorded',
                  enteredOn: rows[0].effectiveOn,
                  percentage: 100,
                  wallets: [],
                },
              ],
            }
          : REGISTER,
      };
    }
    if (url === URLS.HOLDERS(preference.token.uuid)) return { data: preference };
    if (url === URLS.REGISTER_LINK_WAITING_WALLETS) return { data: { wallets: [] } };
    if (url === '/api/v1/company-authority/appointments/') return { data: { results: appointments, next: null } };
    if (url === URLS.REGISTER_ALLOTMENTS) {
      if (config?.params?.token === preference.token.uuid) return { data: { results: [], next: null } };
      if (pauseRead)
        return new Promise((resolve, reject) => {
          releaseRead = () =>
            failedRead
              ? reject(Object.assign(new Error('Synthetic authoritative read refused'), { response: { status: 404 } }))
              : resolve({ data: { results: rows, next: null } });
          pendingReadRelease = releaseRead;
        });
      if (failedRead)
        throw Object.assign(new Error('Synthetic authoritative read refused'), { response: { status: 404 } });
      return { data: { results: rows, next: null } };
    }
    if (rows[0] && url === URLS.REGISTER_ALLOTMENT_RECEIPT_FILE(rows[0].uuid))
      return new Promise((resolve) => {
        releaseFile = () => resolve({ data: new Blob(['synthetic receipt']) });
        pendingFileRelease = releaseFile;
      });
    if (rows[0] && url === URLS.REGISTER_ALLOTMENT(rows[0].uuid)) return { data: rows[0] };
    if (absentPreparation && url === URLS.REGISTER_ALLOTMENT(String(absentPreparation.operationId)))
      throw Object.assign(new Error('Original preparation absent'), { response: { status: 404 } });
    if (url === URLS.REGISTER_MEMBERS(REGISTER.token.uuid)) return { data: { members: [], awardRecipients: [] } };
    if (url.startsWith('/api/v1/tokens/')) return { data: { results: [], next: null } };
    throw new Error(`Unexpected GET ${url}`);
  });
  api.post.mockReset().mockImplementation(async (url, body) => {
    if (url === URLS.REGISTER_EVIDENCE) {
      const form = body as FormData;
      const file = form.get('file') as File;
      return {
        data: {
          uuid: `evidence-${form.get('idempotency_key')}`,
          company: form.get('company_id'),
          appointment: form.get('appointment'),
          kind: form.get('kind'),
          idempotencyKey: form.get('idempotency_key'),
          fileSize: file.size,
          sha256: 'a'.repeat(64),
          providedBy: 'company',
        },
      };
    }
    if (url === URLS.REGISTER_ALLOTMENTS) {
      if (interruptedAbsentPreparation) {
        if (!absentPreparation) {
          absentPreparation = body;
          throw new Error('Synthetic interrupted request before preparation commit');
        }
        throw Object.assign(new Error('Original preparation appointment refused'), { response: { status: 404 } });
      }
      rows = [allotmentFrom(body)];
      throw new Error('Synthetic interrupted preparation response');
    }
    if (url === URLS.REGISTER_ALLOTMENT_PREVIEW(rows[0].uuid))
      return { data: { ...allotmentPreview(rows[0]), ...(incompleteImpact ? { currentHolders: undefined } : {}) } };
    if (url === URLS.REGISTER_ALLOTMENT_DECIDE(rows[0].uuid)) {
      if (body.kind === 'approve' && staleApproval) {
        staleApproval = false;
        throw Object.assign(new Error('Request failed with status code 409'), {
          response: { status: 409, data: { detail: 'The ownership snapshot changed. Preview again.' } },
        });
      }
      const repeated = rows[0].decisions.some((decision) => decision.idempotencyKey === body.idempotencyKey);
      if (!repeated) rows = [allotmentDecision(rows[0], body)];
      if (body.kind === 'apply' && !repeated) throw new Error('Synthetic interrupted issue response');
      return { data: rows[0] };
    }
    throw new Error(`Unexpected POST ${url}`);
  });
  renderCompanyPage(
    client,
    <LedgerNavigationProvider>
      <Sidebar />
      <CompanyRegisterPage />
    </LedgerNavigationProvider>,
    'Ledger',
    { entry: '/company/ledger', path: '/company/ledger' },
  );
  const investorTask = await screen.findByRole('link', { name: 'Issue shares' });
  const transferTask = screen.getByRole('link', { name: 'Transfer shares' });
  const historyTask = screen.getByRole('link', { name: 'History' });
  await waitFor(() => expect(investorTask.getAttribute('aria-disabled')).toBeNull());
  fireEvent.click(investorTask);
  expect(await screen.findByRole('heading', { level: 1, name: 'Issue shares' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: /Class details/ })).toBeNull();
  const taskClass = () => screen.getByLabelText('Share class') as HTMLSelectElement;
  fireEvent.change(await screen.findByLabelText('Share class'), { target: { value: REGISTER.token.uuid } });
  const workflow = await screen.findByRole('region', { name: 'Share issue workflow' });
  const allotments = within(workflow);
  expect(await allotments.findByText('No share issues recorded yet.')).toBeTruthy();
  expect(allotments.queryByRole('radio', { name: 'Investor issue' })).toBeNull();
  const prepareIssue = allotments.getByRole('button', { name: 'Prepare issue' });
  await waitFor(() => expect(prepareIssue.matches(':disabled')).toBe(false));
  fireEvent.click(prepareIssue);
  expect(document.activeElement).toBe(
    allotments.getByRole('heading', { name: 'Prepare share issue' }).parentElement?.parentElement,
  );
  fireEvent.click(allotments.getByRole('button', { name: 'Cancel' }));
  expect(document.activeElement).toBe(allotments.getByRole('button', { name: 'Prepare issue' }));
  fireEvent.click(allotments.getByRole('button', { name: 'Prepare issue' }));
  const investorIssue = await allotments.findByRole('radio', { name: 'Investor issue' });
  await waitFor(() => expect(investorIssue.matches(':disabled')).toBe(false));
  fireEvent.click(investorIssue);
  expect(await allotments.findByRole('group', { name: 'Person and shares' })).toBeTruthy();
  expect(allotments.queryByRole('group', { name: 'Agreement and receipt' })).toBeNull();
  expect(allotments.queryByRole('group', { name: 'Company authority and review' })).toBeNull();
  fireEvent.click(allotments.getByRole('button', { name: 'Continue' }));
  expect(allotments.getByLabelText('Name').getAttribute('aria-invalid')).toBe('true');
  expect(api.post).not.toHaveBeenCalled();
  const agreement = () => within(allotments.getByRole('group', { name: 'Agreement' }));
  const receipt = () => within(allotments.getByRole('group', { name: 'Receipt' }));
  const fillAuthority = () => {
    for (const [label, value] of [
      [COPY.COMPANY_EVENT_ON, ALLOTMENT_REQUEST.companyEventOn],
      [COPY.DIRECTOR, ALLOTMENT_REQUEST.approvingDirector],
      [COPY.AUTHORITY_REFERENCE, ALLOTMENT_REQUEST.authorityReference],
      [COPY.REASON, ALLOTMENT_REQUEST.reason],
    ])
      fireEvent.change(allotments.getByLabelText(label), { target: { value } });
    fireEvent.change(allotments.getByLabelText(COPY.DOCUMENTS.authority), {
      target: { files: [new File(['synthetic'], 'authority.pdf', { type: 'application/pdf' })] },
    });
  };
  const fillForm = (receivedAmount = '249') => {
    const writesBefore = api.post.mock.calls.length;
    act(() => {
      for (const [label, value] of [
        ['Name', ALLOTMENT_REQUEST.name!],
        ['Residential address', ALLOTMENT_REQUEST.residentialAddress!],
        [COPY.SHARES, '100'],
        [COPY.CONSIDERATION, '250'],
      ])
        fireEvent.change(allotments.getByLabelText(label), { target: { value } });
    });
    fireEvent.click(allotments.getByRole('button', { name: 'Continue' }));
    fireEvent.change(agreement().getByLabelText('Document'), {
      target: { files: [new File(['synthetic'], 'evidence.txt', { type: 'text/plain' })] },
    });
    expect(agreement().getByRole('alert').textContent).toBe(UPLOAD_RULE.REFUSAL);
    expect(api.post.mock.calls).toHaveLength(writesBefore);
    act(() => {
      for (const [label, value] of [
        ['Reference', ALLOTMENT_REQUEST.agreementReference],
        ['Date', ALLOTMENT_REQUEST.agreementOn],
        ['Terms', ALLOTMENT_REQUEST.terms],
      ])
        fireEvent.change(agreement().getByLabelText(label), { target: { value } });
      for (const [label, value] of [
        ['Amount received (AUD)', receivedAmount],
        ['Date', ALLOTMENT_REQUEST.receivedOn],
      ])
        fireEvent.change(receipt().getByLabelText(label), { target: { value } });
      for (const group of [agreement(), receipt()])
        fireEvent.change(group.getByLabelText('Document'), {
          target: { files: [new File(['synthetic'], 'evidence.pdf', { type: 'application/pdf' })] },
        });
    });
    if (receivedAmount === '250') {
      fireEvent.click(allotments.getByRole('button', { name: 'Continue' }));
      fillAuthority();
    }
  };
  expect((allotments.getByLabelText(COPY.COMPANY_EVENT_ON) as HTMLInputElement).value).toBe('');
  const refused = (control: HTMLElement, action = COPY.SUBMIT) => {
    fireEvent.click(allotments.getByRole('button', { name: action }));
    expect(document.activeElement).toBe(allotments.getByText('Before continuing:').parentElement);
    expect(control.getAttribute('aria-invalid')).toBe('true');
  };
  fillForm();
  fireEvent.click(allotments.getByRole('button', { name: 'Back' }));
  expect((allotments.getByLabelText(COPY.SHARES) as HTMLInputElement).value).toBe('100');
  expect((allotments.getByLabelText('Name') as HTMLInputElement).value).toBe(ALLOTMENT_REQUEST.name);
  fireEvent.click(allotments.getByRole('button', { name: 'Continue' }));
  expect((agreement().getByLabelText('Document') as HTMLInputElement).files).toHaveLength(1);
  expect((receipt().getByLabelText('Document') as HTMLInputElement).files).toHaveLength(1);
  expect((agreement().getByLabelText('Terms') as HTMLInputElement).value).toBe(ALLOTMENT_REQUEST.terms);
  expect(api.post).not.toHaveBeenCalled();
  refused(receipt().getByLabelText('Amount received (AUD)'), 'Continue');
  fireEvent.change(receipt().getByLabelText('Amount received (AUD)'), { target: { value: '250' } });
  fireEvent.click(allotments.getByRole('button', { name: 'Continue' }));
  fillAuthority();
  expect(allotments.getByText(ALLOTMENT_REQUEST.name!)).toBeTruthy();
  expect(allotments.getByText(/AUD\s250\.00/)).toBeTruthy();
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.change(allotments.getByLabelText(COPY.COMPANY_EVENT_ON), { target: { value: '' } });
  refused(allotments.getByLabelText(COPY.COMPANY_EVENT_ON));
  fireEvent.change(allotments.getByLabelText(COPY.COMPANY_EVENT_ON), { target: { value: '2099-01-01' } });
  refused(allotments.getByLabelText(COPY.COMPANY_EVENT_ON));
  fireEvent.change(allotments.getByLabelText(COPY.COMPANY_EVENT_ON), {
    target: { value: ALLOTMENT_REQUEST.companyEventOn },
  });
  fireEvent.click(allotments.getByRole('button', { name: COPY.SUBMIT }));
  await allotments.findByRole('alert');
  expect(rows[0].registerEntry).toBeNull();
  expect(rows[0].companyEventOn).toBe(ALLOTMENT_REQUEST.companyEventOn);
  expect(allotments.getByLabelText(COPY.CONSIDERATION).matches(':disabled')).toBe(true);
  expect(allotments.getByRole('button', { name: 'Back' }).matches(':disabled')).toBe(true);
  expect(allotments.getByRole('button', { name: 'Cancel' }).matches(':disabled')).toBe(true);
  expect(taskClass().disabled).toBe(true);
  expect(investorTask.getAttribute('aria-disabled')).toBe('true');
  expect(transferTask.getAttribute('aria-disabled')).toBe('true');
  expect(historyTask.getAttribute('aria-disabled')).toBe('true');
  const preparedAllotment = rows[0];
  rows = [{ ...preparedAllotment, companyEventOn: null }];
  const originalReads = api.get.mock.calls.filter(([url]) => url === URLS.REGISTER_ALLOTMENT(rows[0].uuid)).length;
  fireEvent.click(allotments.getByRole('button', { name: COPY.SUBMIT }));
  await waitFor(() =>
    expect(api.get.mock.calls.filter(([url]) => url === URLS.REGISTER_ALLOTMENT(rows[0].uuid))).toHaveLength(
      originalReads + 1,
    ),
  );
  await allotments.findByRole('alert');
  expect(allotments.getByLabelText(COPY.COMPANY_EVENT_ON)).toBeTruthy();
  expect(api.post.mock.calls.filter(([url]) => url === URLS.REGISTER_ALLOTMENTS)).toHaveLength(1);
  rows = [preparedAllotment];
  fireEvent.click(historyTask);
  expect(taskClass().value).toBe(REGISTER.token.uuid);
  expect(allotments.getByLabelText(COPY.CONSIDERATION)).toBeTruthy();
  failedRead = true;
  await refreshAllotments();
  await allotments.findByText(/External allotments could not be loaded/);
  expect(allotments.queryByLabelText('Name')).toBeNull();
  failedRead = false;
  fireEvent.click(allotments.getByRole('button', { name: 'Try again' }));
  await allotments.findByLabelText('Name');
  slowRegister = true;
  fireEvent.click(allotments.getByRole('button', { name: COPY.SUBMIT }));
  await allotments.findByRole('button', { name: /^Review and approve [(]allotment/ });
  expect(allotments.queryByRole('radio', { name: 'Investor issue' })).toBeNull();
  expect(allotments.queryByRole('heading', { name: 'Non-paid issues' })).toBeNull();
  await waitFor(() =>
    expect(document.activeElement).toBe(allotments.getByText('Ready for approval. No shares issued.').closest('li')),
  );
  await waitFor(() => expect(taskClass().disabled).toBe(false));
  await waitFor(() => expect(client.isFetching()).toBe(0));
  slowRegister = false;
  expect(api.post.mock.calls.filter(([url]) => url === URLS.REGISTER_ALLOTMENTS)).toHaveLength(1);
  expect(api.post.mock.calls.filter(([url]) => url === URLS.REGISTER_EVIDENCE)).toHaveLength(3);
  expect(allotments.queryByRole('button', { name: /^Record issue [(]allotment/ })).toBeNull();
  incompleteImpact = true;
  fireEvent.click(allotments.getByRole('button', { name: /^Review and approve [(]allotment/ }));
  const incomplete = await screen.findByRole('dialog', { name: 'Approve external allotment' });
  await within(incomplete).findByText(COPY.OWNERSHIP_UNAVAILABLE);
  expect(
    (within(incomplete).getByRole('button', { name: 'Approve external allotment' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(rows[0].decisions).toHaveLength(0);
  fireEvent.click(within(incomplete).getByRole('button', { name: 'Cancel' }));
  fireEvent.click(allotments.getByRole('button', { name: /^Reject [(]allotment/ }));
  const rejection = await screen.findByRole('dialog', { name: 'Reject external allotment' });
  fireEvent.change(within(rejection).getByLabelText(COPY.REJECTION_REASON), {
    target: { value: 'Withdraw instruction' },
  });
  fireEvent.click(within(rejection).getByRole('button', { name: 'Preview the rejection' }));
  await waitFor(() =>
    expect(
      (within(rejection).getByRole('button', { name: 'Reject external allotment' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  expect(within(rejection).queryByText(COPY.OWNERSHIP_TITLE)).toBeNull();
  fireEvent.click(within(rejection).getByRole('button', { name: 'Cancel' }));
  incompleteImpact = false;
  fireEvent.click(allotments.getByRole('button', { name: /^Review and approve [(]allotment/ }));
  const stale = await screen.findByRole('dialog', { name: 'Approve external allotment' });
  const staleConfirm = within(stale).getByRole('button', { name: 'Approve external allotment' });
  await waitFor(() => expect((staleConfirm as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(staleConfirm);
  await within(stale).findByText('The ownership snapshot changed. Preview again.');
  expect(rows[0].decisions).toHaveLength(0);
  expect(rows[0].registerEntry).toBeNull();
  fireEvent.click(within(stale).getByRole('button', { name: 'Cancel' }));
  for (const kind of ['approve', 'apply'] as const) {
    const label = kind === 'apply' ? 'Record issue' : COPY.DECISIONS[kind];
    fireEvent.click(
      allotments.getByRole('button', {
        name: new RegExp(`^${kind === 'approve' ? 'Review and approve' : label} \\(allotment`),
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: `${label} external allotment` });
    expect(
      within(within(dialog).getByText(COPY.COMPANY_EVENT_ON).parentElement!).getByText(
        formatDate(ALLOTMENT_REQUEST.companyEventOn),
      ),
    ).toBeTruthy();
    const confirm = within(dialog).getByRole('button', { name: `${label} external allotment` });
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
    expect(within(dialog).getByText('Ordinary shares (ORD)')).toBeTruthy();
    expect(within(dialog).getByText('AUD 2.5000')).toBeTruthy();
    expect(within(dialog).getByText('100.00%')).toBeTruthy();
    expect(within(dialog).getByRole('table', { name: 'Share class ownership forecast' })).toBeTruthy();
    expect(within(dialog).getByText(COPY.OWNERSHIP_NOTE)).toBeTruthy();
    fireEvent.click(confirm);
    await waitFor(() => expect(rows[0].decisions).toHaveLength(kind === 'approve' ? 1 : 2));
    if (kind === 'approve') {
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(rows[0].registerEntry).toBeNull();
      await allotments.findByText('Next: record the approved share issue. Approval has not changed ownership.');
    }
  }
  await allotments.findByRole('button', { name: /^Recover record issue receipt/ });
  expect(taskClass().disabled).toBe(true);
  expect(transferTask.getAttribute('aria-disabled')).toBe('true');
  expect(historyTask.getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(transferTask);
  expect(taskClass().value).toBe(REGISTER.token.uuid);
  expect(allotments.getByRole('button', { name: /^Recover record issue receipt/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('link', { name: /^Documents$/ }));
  expect(await screen.findByRole('heading', { level: 1, name: 'Documents' })).toBeTruthy();
  await waitFor(() => expect(investorTask.getAttribute('aria-disabled')).toBeNull());
  expect(transferTask.getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(investorTask);
  expect(await screen.findByRole('heading', { level: 1, name: 'Issue shares' })).toBeTruthy();
  expect(allotments.getByRole('button', { name: /^Recover record issue receipt/ })).toBeTruthy();
  pauseRead = true;
  failedRead = true;
  await refreshAllotments();
  await waitFor(() => expect(releaseRead).toBeTypeOf('function'));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.body.textContent).not.toContain(ALLOTMENT_REQUEST.name);
  expect(document.body.textContent).not.toContain(ALLOTMENT_REQUEST.residentialAddress);
  expect(document.body.textContent).not.toContain(ALLOTMENT_REQUEST.agreementReference);
  expect(allotments.queryByRole('button', { name: /^Recover record issue receipt/ })).toBeNull();
  await act(async () => releaseRead!());
  pendingReadRelease = undefined;
  await allotments.findByText(/External allotments could not be loaded/);
  expect(allotments.queryByText('entry-a')).toBeNull();
  pauseRead = false;
  failedRead = false;
  appointments = [{ ...APPOINTMENT, capabilities: ['read_register'] }];
  fireEvent.click(allotments.getByRole('button', { name: 'Try again' }));
  const recover = await allotments.findByRole('button', { name: /^Recover record issue receipt/ });
  expect(screen.getByRole('heading', { level: 1, name: 'Issue shares' })).toBeTruthy();
  expect(screen.queryByRole('region', { name: `${REGISTER.token.name} share summary` })).toBeNull();
  expect(allotments.queryByRole('button', { name: /^Record issue [(]allotment/ })).toBeNull();
  expect(recover).toBeTruthy();
  fireEvent.click(await allotments.findByRole('button', { name: /^Recover record issue receipt/ }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await allotments.findByText('Shares issued');
  expect(allotments.queryByText(COPY.OWNERSHIP_TITLE)).toBeNull();
  const originalIssues = api.post.mock.calls.filter(
    ([url, body]) => url === URLS.REGISTER_ALLOTMENT_DECIDE(rows[0].uuid) && body.kind === 'apply',
  );
  expect(originalIssues).toHaveLength(2);
  expect(originalIssues[1][1]).toEqual(originalIssues[0][1]);
  expect(
    api.post.mock.calls.filter(
      ([url, body]) => url === URLS.REGISTER_ALLOTMENT_PREVIEW(rows[0].uuid) && body.kind === 'apply',
    ),
  ).toHaveLength(1);
  expect(rows[0].decisions).toHaveLength(2);
  fireEvent.click(allotments.getByText('Details and documents'));
  await allotments.findByText('entry-a');
  expect(rows[0].registerEntry).toBe('entry-a');
  fireEvent.click(allotments.getByRole('button', { name: /^Download receipt/ }));
  await waitFor(() => expect(releaseFile).toBeTypeOf('function'));
  failedRead = true;
  await refreshAllotments();
  await allotments.findByText(/External allotments could not be loaded/);
  expect(allotments.queryByText('entry-a')).toBeNull();
  expect(allotments.queryByText(ALLOTMENT_REQUEST.agreementReference)).toBeNull();
  expect(allotments.queryByRole('button', { name: /^Download receipt/ })).toBeNull();
  await act(async () => releaseFile!());
  pendingFileRelease = undefined;
  expect(save).not.toHaveBeenCalled();
  failedRead = false;
  fireEvent.click(allotments.getByRole('button', { name: 'Try again' }));
  await allotments.findByText('Shares issued');
  expect(allotments.getByText('entry-a')).toBeTruthy();
  expect(allotments.getByText(ALLOTMENT_REQUEST.agreementReference)).toBeTruthy();
  appointments = [{ ...APPOINTMENT, capabilities: ['finance'] }];
  await refreshAllotments();
  await waitFor(() => expect(allotments.queryByText('entry-a')).toBeNull());
  expect(allotments.queryByText(ALLOTMENT_REQUEST.agreementReference)).toBeNull();
  expect(allotments.queryByRole('button', { name: /^Download receipt/ })).toBeNull();
  interruptedAbsentPreparation = true;
  appointments = [APPOINTMENT];
  await refreshAllotments();
  const prepareAnother = await allotments.findByRole('button', { name: 'Prepare issue' });
  await waitFor(() => expect(prepareAnother.matches(':disabled')).toBe(false));
  fireEvent.click(prepareAnother);
  fireEvent.click(await allotments.findByRole('radio', { name: 'Investor issue' }));
  await allotments.findByLabelText('Name');
  fillForm('250');
  fireEvent.click(allotments.getByRole('button', { name: COPY.SUBMIT }));
  await allotments.findByText(COPY.PREPARATION_RECEIPT_FAILED);
  appointments = [{ ...APPOINTMENT, uuid: 'replacement-preparation-appointment' }];
  await refreshAllotments();
  await allotments.findByLabelText('Name');
  fireEvent.click(allotments.getByRole('button', { name: COPY.SUBMIT }));
  await allotments.findByText(
    'The original allotment was not recorded and the request was refused. Close this form and start again with current company authority.',
  );
  const refusedPreparations = api.post.mock.calls.filter(
    ([url, body]) => url === URLS.REGISTER_ALLOTMENTS && body.operationId === absentPreparation?.operationId,
  );
  expect(refusedPreparations).toHaveLength(2);
  expect(refusedPreparations[1][1]).toEqual(refusedPreparations[0][1]);
  expect(refusedPreparations[1][1].appointment).toBe(APPOINTMENT.uuid);
  expect(
    api.get.mock.calls.filter(([url]) => url === URLS.REGISTER_ALLOTMENT(String(absentPreparation?.operationId))),
  ).toHaveLength(2);
  const close = allotments.getByRole('button', { name: 'Cancel' });
  await waitFor(() => expect(close.matches(':disabled')).toBe(false));
  fireEvent.click(close);
  expect(rows[0].registerEntry).toBe('entry-a');
  expect(rows[0].decisions).toHaveLength(2);
  await waitFor(() => expect(taskClass().disabled).toBe(false));
  await waitFor(() => expect(historyTask.getAttribute('aria-disabled')).toBeNull());
  fireEvent.click(historyTask);
  fireEvent.change(taskClass(), { target: { value: preference.token.uuid } });
  expect(
    (await screen.findAllByRole('heading', { name: `${preference.token.name} · ${preference.token.symbol}` })).find(
      (heading) => heading.closest('li'),
    ),
  ).toBeTruthy();
  expect(screen.queryByText('entry-a')).toBeNull();
  fireEvent.change(taskClass(), { target: { value: REGISTER.token.uuid } });
  fireEvent.click(investorTask);
  await allotments.findByText('Shares issued');
  expect(rows[0].registerEntry).toBe('entry-a');
  expect(rows[0].decisions).toHaveLength(2);
  cleanup();
  client.clear();
  const earlierPost = api.post.getMockImplementation()!;
  api.post.mockImplementation(async (url, body) => {
    if (url === URLS.REGISTER_TRANSFERS) throw new Error('Synthetic interrupted transfer preparation');
    return earlierPost(url, body);
  });
  renderCompanyPage(
    client,
    <TransferForm
      owner={owner}
      guard={() => {}}
      company={APPOINTMENT.company}
      token={REGISTER.token.uuid}
      people={[
        {
          member: 'transferor',
          name: 'Synthetic Transferor',
          residentialAddress: '1 Example Street',
          currentShares: '100',
          lastCeasedOn: null,
          walletless: true,
          particularsRetained: true,
          awardOnly: false,
        },
      ]}
      appointment={APPOINTMENT}
      blocked={false}
      onRefused={() => {}}
    />,
    'Transfer shares',
  );
  expect((screen.getByLabelText(TRANSFER_COPY.COMPANY_EVENT_ON) as HTMLInputElement).value).toBe('');
  await choose(TRANSFER_COPY.FROM, 'Synthetic Transferor', 'synthetic');
  for (const [label, value] of [
    ['Name', 'Synthetic Recipient'],
    ['Residential address', '2 Example Street'],
    [TRANSFER_COPY.SHARES, '10'],
    [TRANSFER_COPY.SIGNED_ON, '2026-10-01'],
    [TRANSFER_COPY.LODGED_ON, '2026-10-02'],
    [TRANSFER_COPY.TERMS, 'Non-paid transfer'],
    [TRANSFER_COPY.DIRECTOR, 'Synthetic Director'],
    [TRANSFER_COPY.AUTHORITY_REFERENCE, 'Synthetic resolution'],
    [TRANSFER_COPY.REASON, 'Record company transfer'],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  for (const label of [TRANSFER_COPY.AUTHORITY_DOCUMENT, TRANSFER_COPY.INSTRUMENT_DOCUMENT])
    fireEvent.change(screen.getByLabelText(label), {
      target: { files: [new File(['synthetic'], 'evidence.pdf', { type: 'application/pdf' })] },
    });
  fireEvent.click(screen.getByRole('button', { name: TRANSFER_COPY.SUBMIT }));
  expect(document.activeElement).toBe(screen.getByText('Before continuing:').parentElement);
  expect(screen.getByLabelText(TRANSFER_COPY.COMPANY_EVENT_ON).getAttribute('aria-invalid')).toBe('true');
  fireEvent.change(screen.getByLabelText(TRANSFER_COPY.COMPANY_EVENT_ON), { target: { value: '2026-10-03' } });
  fireEvent.click(screen.getByRole('button', { name: TRANSFER_COPY.SUBMIT }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: TRANSFER_COPY.SUBMIT }));
  await waitFor(() => expect(api.post.mock.calls.filter(([url]) => url === URLS.REGISTER_TRANSFERS)).toHaveLength(2));
  const transfers = api.post.mock.calls.filter(([url]) => url === URLS.REGISTER_TRANSFERS);
  expect(transfers[1][1]).toEqual(transfers[0][1]);
  expect(transfers[0][1]).toMatchObject({
    companyEventOn: '2026-10-03',
    signedOn: '2026-10-01',
    lodgedOn: '2026-10-02',
  });
});
