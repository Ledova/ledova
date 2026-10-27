// @vitest-environment jsdom

import { Sidebar } from '@components/Sidebar';
import { LedgerNavigationProvider } from '@components/LedgerNavigationProvider';
import { CompanyContextProvider } from '@components/CompanyContextProvider';
import { ownAppointmentsKey } from '@hooks/useOwnAppointments';

import {
  COMPANY_TOKEN_ENDPOINTS as URLS,
  REGISTER_ALLOTMENT_COPY as COPY,
  REGISTER_TRANSFER_COPY as TRANSFER_COPY,
  UPLOAD_RULE,
  formatDate,
  type RegisterAllotment,
  type RegisterTransfer,
  type OwnCompanyAppointment,
} from '@ledova/shared';
import { QueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { APPOINTMENT, REGISTER } from '../../../testSupport/company';
import { ALLOTMENT_REQUEST, allotmentFrom, allotmentDecision, allotmentPreview } from '../../../testSupport/company';
import CompanyRegisterPage from '.';
import { choose, companyPreferences, renderCompanyPage } from '../../../testSupport/company';

import { allotmentsKey } from './useRegisterAllotments';
import { TransferForm } from './transfer/TransferForm';
import { registerClassesKey } from '@hooks/useRegisterClasses';

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

it('preserves original preparation and combined approval recovery through refresh and hides private records on failed source or authority reads', async () => {
  let rows: RegisterAllotment[] = [];
  let appointments: OwnCompanyAppointment[] = [APPOINTMENT];
  let failedRead = false;
  let failedRegisterRead = false;
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
    if (url === '/api/user-profiles/' || url === '/api/feature-flags/' || url === '/api/v1/companies/')
      return { data: { results: [], next: null } };
    if (url === '/api/user-preferences/') {
      return { data: companyPreferences() };
    }
    if (url === URLS.REGISTER) {
      if (failedRegisterRead) throw new Error('Synthetic register source unavailable');
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
      return {
        data: {
          ...allotmentPreview(rows[0]),
          completeIssue: body.completeIssue === true,
          applyAppointment: body.applyAppointment ?? body.appointment,
          ...(incompleteImpact ? { currentHolders: undefined } : {}),
        },
      };
    if (url === URLS.REGISTER_ALLOTMENT_DECIDE(rows[0].uuid)) {
      if (body.kind === 'approve' && staleApproval) {
        staleApproval = false;
        throw Object.assign(new Error('Request failed with status code 409'), {
          response: { status: 409, data: { detail: 'The ownership snapshot changed. Preview again.' } },
        });
      }
      const repeated = rows[0].decisions.some((decision) => decision.idempotencyKey === body.idempotencyKey);
      if (!repeated) rows = [allotmentDecision(rows[0], body)];
      if (body.completeIssue && !repeated) throw new Error('Synthetic interrupted issue response');
      return { data: rows[0] };
    }
    throw new Error(`Unexpected POST ${url}`);
  });
  renderCompanyPage(
    client,
    <LedgerNavigationProvider>
      <CompanyContextProvider>
        <Sidebar />
        <CompanyRegisterPage />
        <Link to="/company/ledger#history">Open old History link</Link>
        <Link to="/company/ledger#issue">Return to Issue link</Link>
      </CompanyContextProvider>
    </LedgerNavigationProvider>,
    'Ledger',
    { entry: '/company/ledger', path: '/company/ledger' },
  );
  await screen.findByRole('link', { name: 'Issue shares' });
  const investorTask = () => screen.getByRole('link', { name: 'Issue shares' });
  const transferTask = () => screen.getByRole('link', { name: 'Transfer shares' });
  expect(screen.queryByRole('link', { name: 'History' })).toBeNull();
  const correctionsTask = () => screen.getByRole('link', { name: 'Corrections' });
  await waitFor(() => expect(investorTask().getAttribute('aria-disabled')).toBeNull());
  failedRegisterRead = true;
  await act(async () => client.refetchQueries({ queryKey: registerClassesKey(owner), exact: true }));
  await waitFor(() => expect(investorTask().getAttribute('aria-disabled')).toBe('true'));
  expect(screen.queryByRole('combobox', { name: 'Workspace' })).toBeNull();
  failedRegisterRead = false;
  await act(async () => client.refetchQueries({ queryKey: registerClassesKey(owner), exact: true }));
  await waitFor(() => expect(investorTask().getAttribute('aria-disabled')).toBeNull());
  fireEvent.click(investorTask());
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
  fireEvent.click(allotments.getByRole('button', { name: 'Cancel' }));
  expect(document.activeElement).toBe(allotments.getByRole('button', { name: 'Prepare issue' }));
  fireEvent.click(allotments.getByRole('button', { name: 'Prepare issue' }));
  fireEvent.click(allotments.getByRole('radio', { name: 'Non-paid issue' }));
  fireEvent.click(await allotments.findByRole('button', { name: 'Cancel' }));
  expect(document.activeElement).toBe(allotments.getByRole('button', { name: 'Prepare issue' }));
  fireEvent.click(allotments.getByRole('button', { name: 'Prepare issue' }));
  fireEvent.click(allotments.getByRole('radio', { name: 'Investor issue' }));
  await allotments.findByRole('group', { name: 'Person and shares' });
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
  expect(investorTask().getAttribute('aria-disabled')).toBe('true');
  expect(transferTask().getAttribute('aria-disabled')).toBe('true');
  expect(correctionsTask().getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(screen.getByRole('link', { name: 'Dashboard' }));
  expect(screen.getByRole('heading', { level: 1, name: 'Issue shares' })).toBeTruthy();
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
  fireEvent.click(correctionsTask());
  expect(taskClass().value).toBe(REGISTER.token.uuid);
  expect(allotments.getByLabelText(COPY.CONSIDERATION)).toBeTruthy();
  const beforeOldLink = api.post.mock.calls.length;
  fireEvent.click(screen.getByRole('link', { name: 'Open old History link' }));
  expect(await screen.findByRole('heading', { level: 1, name: 'Issue shares' })).toBeTruthy();
  expect(taskClass().value).toBe(REGISTER.token.uuid);
  expect(allotments.getByLabelText(COPY.CONSIDERATION)).toBeTruthy();
  expect(api.post.mock.calls).toHaveLength(beforeOldLink);
  fireEvent.click(screen.getByRole('link', { name: 'Return to Issue link' }));
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
  const preparedIssue = allotments.getByRole('heading', { name: preparedAllotment.name, level: 3 }).closest('li')!;
  expect(within(preparedIssue.querySelector('dl')!).getByText('Investor issue')).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(preparedIssue));
  await waitFor(() => expect(taskClass().disabled).toBe(false));
  await waitFor(() => expect(client.isFetching()).toBe(0));
  slowRegister = false;
  expect(api.post.mock.calls.filter(([url]) => url === URLS.REGISTER_ALLOTMENTS)).toHaveLength(1);
  expect(api.post.mock.calls.filter(([url]) => url === URLS.REGISTER_EVIDENCE)).toHaveLength(3);
  expect(allotments.queryByRole('button', { name: /^Record issue [(]allotment/ })).toBeNull();
  incompleteImpact = true;
  fireEvent.click(allotments.getByRole('button', { name: /^Review and approve [(]allotment/ }));
  const incomplete = await screen.findByRole('region', { name: 'Review share issue' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(allotments.queryByRole('button', { name: 'Prepare issue' })).toBeNull();
  expect(taskClass().disabled).toBe(true);
  expect(transferTask().getAttribute('aria-disabled')).toBe('true');
  expect(document.activeElement).toBe(within(incomplete).getByRole('heading', { name: 'Review share issue' }));
  await within(incomplete).findByText(COPY.OWNERSHIP_UNAVAILABLE);
  expect((within(incomplete).getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true);
  expect(rows[0].decisions).toHaveLength(0);
  fireEvent.click(within(incomplete).getByRole('button', { name: 'Cancel' }));
  await waitFor(() =>
    expect(document.activeElement).toBe(allotments.getByRole('button', { name: /^Review and approve [(]allotment/ })),
  );
  expect(rows[0].decisions).toHaveLength(0);
  fireEvent.click(allotments.getByRole('button', { name: /^Reject [(]allotment/ }));
  const rejection = await screen.findByRole('region', { name: 'Review share issue' });
  fireEvent.change(within(rejection).getByLabelText(COPY.REJECTION_REASON), {
    target: { value: 'Withdraw instruction' },
  });
  fireEvent.click(within(rejection).getByRole('button', { name: 'Preview the rejection' }));
  await waitFor(() =>
    expect((within(rejection).getByRole('button', { name: 'Reject allotment' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  expect(within(rejection).queryByText(COPY.OWNERSHIP_TITLE)).toBeNull();
  fireEvent.click(within(rejection).getByRole('button', { name: 'Cancel' }));
  incompleteImpact = false;
  fireEvent.click(allotments.getByRole('button', { name: /^Review and approve [(]allotment/ }));
  const stale = await screen.findByRole('region', { name: 'Review share issue' });
  const staleConfirm = within(stale).getByRole('button', { name: 'Approve' });
  await waitFor(() => expect((staleConfirm as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(staleConfirm);
  await within(stale).findByText('The ownership snapshot changed. Preview again.');
  expect(rows[0].decisions).toHaveLength(0);
  expect(rows[0].registerEntry).toBeNull();
  fireEvent.click(within(stale).getByRole('button', { name: 'Cancel' }));
  const previewCount = () =>
    api.post.mock.calls.filter(
      ([url, body]) => url === URLS.REGISTER_ALLOTMENT_PREVIEW(rows[0].uuid) && body.completeIssue === true,
    ).length;
  const previewsBeforeConfirmation = previewCount();
  fireEvent.click(allotments.getByRole('button', { name: /^Review and approve [(]allotment/ }));
  const review = await screen.findByRole('region', { name: 'Review share issue' });
  expect(
    within(within(review).getByText('Company issue date').parentElement!).getByText(
      formatDate(ALLOTMENT_REQUEST.companyEventOn),
    ),
  ).toBeTruthy();
  const confirm = within(review).getByRole('button', { name: 'Approve' });
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
  expect(within(review).getByText('Ordinary shares (ORD)')).toBeTruthy();
  expect(within(review).getByText('AUD 2.5000')).toBeTruthy();
  expect(within(review).getByText('100.00%')).toBeTruthy();
  expect(within(review).getByRole('table', { name: 'Share class ownership forecast' })).toBeTruthy();
  expect(within(review).queryByRole('button', { name: 'Record issue' })).toBeNull();
  expect(rows[0].decisions).toHaveLength(0);
  fireEvent.click(confirm);
  await waitFor(() => expect(rows[0].decisions).toHaveLength(2));
  const uncertainReview = await allotments.findByRole('region', { name: 'Review share issue' });
  await within(uncertainReview).findByRole('button', { name: 'Recover original decision receipt' });
  const cancelUncertain = within(uncertainReview).getByRole('button', { name: 'Cancel' });
  await waitFor(() => expect(cancelUncertain.matches(':disabled')).toBe(false));
  fireEvent.click(cancelUncertain);
  await allotments.findByRole('button', { name: /^Recover approve receipt/ });
  expect(taskClass().disabled).toBe(true);
  expect(transferTask().getAttribute('aria-disabled')).toBe('true');
  expect(correctionsTask().getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(transferTask());
  expect(taskClass().value).toBe(REGISTER.token.uuid);
  expect(allotments.getByRole('button', { name: /^Recover approve receipt/ })).toBeTruthy();
  expect(screen.getByRole('link', { name: /^Documents$/ }).getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(screen.getByRole('link', { name: /^Documents$/ }));
  expect(screen.getByRole('heading', { level: 1, name: 'Issue shares' })).toBeTruthy();
  expect(allotments.getByRole('button', { name: /^Recover approve receipt/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Expand Documents navigation' }));
  expect(screen.getByRole('link', { name: 'Certificates' }).getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(screen.getByRole('link', { name: 'Ledger exports' }));
  expect(await screen.findByRole('heading', { level: 1, name: 'Ledger exports' })).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'Download CSV' })).toHaveLength(1);
  expect(screen.queryByRole('list', { name: 'Certificate records' })).toBeNull();
  fireEvent.click(screen.getByRole('link', { name: 'Company pack' }));
  expect(await screen.findByRole('heading', { level: 1, name: 'Company pack' })).toBeTruthy();
  expect(screen.queryByLabelText('Share class')).toBeNull();
  await waitFor(() => expect(investorTask().getAttribute('aria-disabled')).toBeNull());
  expect(transferTask().getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(investorTask());
  expect(await screen.findByRole('heading', { level: 1, name: 'Issue shares' })).toBeTruthy();
  expect(allotments.getByRole('button', { name: /^Recover approve receipt/ })).toBeTruthy();
  pauseRead = true;
  failedRead = true;
  await refreshAllotments();
  await waitFor(() => expect(releaseRead).toBeTypeOf('function'));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Review share issue' })).toBeNull());
  expect(document.body.textContent).not.toContain(ALLOTMENT_REQUEST.name);
  expect(document.body.textContent).not.toContain(ALLOTMENT_REQUEST.residentialAddress);
  expect(document.body.textContent).not.toContain(ALLOTMENT_REQUEST.agreementReference);
  expect(allotments.queryByRole('button', { name: /^Recover approve receipt/ })).toBeNull();
  await act(async () => releaseRead!());
  pendingReadRelease = undefined;
  await allotments.findByText(/External allotments could not be loaded/);
  expect(allotments.queryByText('entry-a')).toBeNull();
  pauseRead = false;
  failedRead = false;
  appointments = [{ ...APPOINTMENT, capabilities: ['read_register'] }];
  fireEvent.click(allotments.getByRole('button', { name: 'Try again' }));
  const recover = await allotments.findByRole('button', { name: /^Recover approve receipt/ });
  expect(screen.getByRole('heading', { level: 1, name: 'Issue shares' })).toBeTruthy();
  expect(screen.queryByRole('region', { name: `${REGISTER.token.name} share summary` })).toBeNull();
  expect(allotments.queryByRole('button', { name: /^Record issue [(]allotment/ })).toBeNull();
  expect(recover).toBeTruthy();
  fireEvent.click(await allotments.findByRole('button', { name: /^Recover approve receipt/ }));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Review share issue' })).toBeNull());
  await allotments.findByText('Approved');
  expect(allotments.queryByText(COPY.OWNERSHIP_TITLE)).toBeNull();
  const originalIssues = api.post.mock.calls.filter(
    ([url, body]) =>
      url === URLS.REGISTER_ALLOTMENT_DECIDE(rows[0].uuid) &&
      body.idempotencyKey === rows[0].decisions.find((decision) => decision.completeIssue)?.idempotencyKey,
  );
  expect(originalIssues).toHaveLength(2);
  expect(originalIssues[1][1]).toEqual(originalIssues[0][1]);
  expect(originalIssues[0][1]).toMatchObject({
    kind: 'approve',
    completeIssue: true,
    applyAppointment: APPOINTMENT.uuid,
  });
  expect(previewCount()).toBe(previewsBeforeConfirmation + 1);
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
  await allotments.findByText('Approved');
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
  await waitFor(() => expect(correctionsTask().getAttribute('aria-disabled')).toBeNull());
  expect(correctionsTask().getAttribute('aria-disabled')).toBeNull();
  fireEvent.click(correctionsTask());
  fireEvent.change(taskClass(), { target: { value: preference.token.uuid } });
  expect(
    (await screen.findAllByRole('heading', { name: `${preference.token.name} · ${preference.token.symbol}` })).find(
      (heading) => heading.closest('li'),
    ),
  ).toBeTruthy();
  expect(screen.queryByText('entry-a')).toBeNull();
  fireEvent.change(taskClass(), { target: { value: REGISTER.token.uuid } });
  fireEvent.click(investorTask());
  await allotments.findByText('Approved');
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
      classLabel="Ordinary shares (ORD)"
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
        {
          member: 'recipient',
          name: 'Synthetic Recipient',
          residentialAddress: '2 Example Street',
          currentShares: '0',
          lastCeasedOn: null,
          walletless: true,
          particularsRetained: true,
          awardOnly: false,
          onRegister: false,
          hasAwards: false,
        },
      ]}
      appointment={APPOINTMENT}
      blocked={false}
      onRefused={() => {}}
    />,
    'Transfer shares',
  );
  const requestsBeforeTransfer = api.post.mock.calls.length;
  expect((screen.getByLabelText(TRANSFER_COPY.COMPANY_EVENT_ON) as HTMLInputElement).value).toBe('');
  await choose(TRANSFER_COPY.FROM, 'Synthetic Transferor', 'synthetic');
  fireEvent.focus(screen.getByRole('combobox', { name: TRANSFER_COPY.TO }));
  expect(screen.queryByRole('option', { name: 'New person' })).toBeNull();
  expect(screen.queryByLabelText('Name')).toBeNull();
  await choose(TRANSFER_COPY.TO, 'Synthetic Recipient', 'recipient');
  fireEvent.change(screen.getByLabelText(TRANSFER_COPY.SHARES), { target: { value: '10' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(document.activeElement).toBe(screen.getByText('Before continuing:').parentElement);
  expect(screen.getByLabelText(TRANSFER_COPY.COMPANY_EVENT_ON).getAttribute('aria-invalid')).toBe('true');
  fireEvent.change(screen.getByLabelText(TRANSFER_COPY.COMPANY_EVENT_ON), { target: { value: '2026-10-03' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  const transferDocuments = () => within(screen.getByRole('group', { name: 'Transfer documents' }));
  for (const [label, value] of [
    ['Signed on', '2026-10-01'],
    ['Lodged with company on', '2026-10-02'],
    ['Terms', 'Non-paid transfer'],
  ])
    fireEvent.change(transferDocuments().getByLabelText(label), { target: { value } });
  fireEvent.change(transferDocuments().getByLabelText('Document'), {
    target: { files: [new File(['synthetic'], 'instrument.pdf', { type: 'application/pdf' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect((screen.getByLabelText(TRANSFER_COPY.SHARES) as HTMLInputElement).value).toBe('10');
  expect((screen.getByRole('combobox', { name: TRANSFER_COPY.TO }) as HTMLInputElement).value).toBe(
    'Synthetic Recipient',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect((transferDocuments().getByLabelText('Document') as HTMLInputElement).files).toHaveLength(1);
  expect((transferDocuments().getByLabelText('Terms') as HTMLInputElement).value).toBe('Non-paid transfer');
  expect((transferDocuments().getByLabelText('Signed on') as HTMLInputElement).value).toBe('2026-10-01');
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  const companyAuthority = () => within(screen.getByRole('group', { name: 'Company authority' }));
  for (const [label, value] of [
    ['Approving director', 'Synthetic Director'],
    ['Authority reference', 'Synthetic resolution'],
    ['Reason', 'Record company transfer'],
  ])
    fireEvent.change(companyAuthority().getByLabelText(label), { target: { value } });
  expect(api.post.mock.calls).toHaveLength(requestsBeforeTransfer);
  expect(screen.getByText('Synthetic Recipient')).toBeTruthy();
  expect(screen.getByText('Ordinary shares (ORD)')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: TRANSFER_COPY.SUBMIT }));
  expect(companyAuthority().getByLabelText('Document').getAttribute('aria-invalid')).toBe('true');
  fireEvent.change(companyAuthority().getByLabelText('Document'), {
    target: { files: [new File(['synthetic'], 'authority.pdf', { type: 'application/pdf' })] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect((transferDocuments().getByLabelText('Document') as HTMLInputElement).files).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect((companyAuthority().getByLabelText('Document') as HTMLInputElement).files).toHaveLength(1);
  expect(api.post.mock.calls).toHaveLength(requestsBeforeTransfer);
  fireEvent.click(screen.getByRole('button', { name: TRANSFER_COPY.SUBMIT }));
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'Back' }).matches(':disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: TRANSFER_COPY.SUBMIT }));
  await waitFor(() => expect(api.post.mock.calls.filter(([url]) => url === URLS.REGISTER_TRANSFERS)).toHaveLength(2));
  const transfers = api.post.mock.calls.filter(([url]) => url === URLS.REGISTER_TRANSFERS);
  expect(transfers[1][1]).toEqual(transfers[0][1]);
  expect(transfers[0][1]).toMatchObject({
    toMember: 'recipient',
    newMember: false,
    companyEventOn: '2026-10-03',
    signedOn: '2026-10-01',
    lodgedOn: '2026-10-02',
  });
  cleanup();
  client.clear();
  appointments = [
    { ...APPOINTMENT, capabilities: ['prepare', 'approve', 'read_register'] },
    { ...APPOINTMENT, uuid: 'transfer-apply', capabilities: ['apply'] },
  ];
  let transferMovements = 0;
  let transfer: RegisterTransfer = {
    ...rows[0],
    uuid: 'transfer-a',
    fromMember: 'transferor',
    fromName: 'Synthetic Transferor',
    fromResidentialAddress: '1 Example Street',
    fromParticulars: {},
    toMember: 'recipient',
    name: 'Synthetic Recipient',
    residentialAddress: '2 Example Street',
    toParticulars: {},
    newMember: false,
    newParticulars: false,
    shares: '10',
    companyEventOn: '2026-10-03',
    signedOn: '2026-10-01',
    lodgedOn: '2026-10-02',
    terms: 'Non-paid transfer',
    authority: 'director_resolution',
    instrumentEvidence: 'instrument-a',
    instrumentFingerprint: 'a'.repeat(64),
    instrumentSnapshot: {},
    status: 'submitted',
    stage: 'submitted',
    decisions: [],
    registerEntry: null,
    effectiveOn: null,
    reviewedAt: null,
    reviewedBy: null,
  };
  const earlierGet = api.get.getMockImplementation()!;
  api.get.mockImplementation(async (url, config?: { params?: { token?: string } }) => {
    if (url === URLS.REGISTER_TRANSFERS)
      return { data: { results: config?.params?.token === preference.token.uuid ? [] : [transfer], next: null } };
    return earlierGet(url, config);
  });
  api.post.mockImplementation(async (url, body) => {
    if (url === URLS.REGISTER_TRANSFER_PREVIEW(transfer.uuid))
      return {
        data: {
          ...transfer,
          completeTransfer: body.completeTransfer === true,
          applyAppointment: body.applyAppointment,
          effectiveOn: transfer.companyEventOn,
          previewDigest: 'c'.repeat(64),
          canDecide: true,
          unmetRequirements: [],
          registerSequence: 2,
          fromCurrentShares: '100',
          fromAfterShares: '90',
          toCurrentShares: '0',
          toAfterShares: '10',
          issuedSupply: '100',
          afterIssuedSupply: '100',
          authorisedSupply: '1000',
        },
      };
    if (url === URLS.REGISTER_TRANSFER_DECIDE(transfer.uuid)) {
      if (!transfer.decisions.some((decision) => decision.idempotencyKey === body.idempotencyKey)) {
        transferMovements += 1;
        transfer = {
          ...transfer,
          stage: 'applied',
          status: 'applied',
          registerEntry: 'transfer-entry-a',
          effectiveOn: transfer.companyEventOn,
          reviewedAt: '2026-10-22T00:00:00Z',
          reviewedBy: 1,
          decisions: [
            {
              uuid: `approval-${body.idempotencyKey}`,
              appointment: body.appointment,
              kind: 'approve',
              digest: body.previewDigest,
              idempotencyKey: `approval-${body.idempotencyKey}`,
              reason: '',
              decidedAt: '2026-10-22T00:00:00Z',
              decidedBy: 1,
              decidedByName: 'Synthetic Appointee',
              completeTransfer: false,
              approvalAppointment: null,
            },
            {
              uuid: body.idempotencyKey,
              appointment: body.applyAppointment,
              kind: 'apply',
              digest: body.previewDigest,
              idempotencyKey: body.idempotencyKey,
              reason: body.reason || '',
              decidedAt: '2026-10-22T00:00:00Z',
              decidedBy: 1,
              decidedByName: 'Synthetic Appointee',
              completeTransfer: true,
              approvalAppointment: body.appointment,
            },
          ],
        };
        throw new Error('Synthetic interrupted transfer approval response');
      }
      return { data: transfer };
    }
    return earlierPost(url, body);
  });
  renderCompanyPage(
    client,
    <LedgerNavigationProvider>
      <CompanyContextProvider>
        <Sidebar />
        <CompanyRegisterPage />
      </CompanyContextProvider>
    </LedgerNavigationProvider>,
    'Ledger',
    { entry: '/company/ledger#transfer', path: '/company/ledger' },
  );
  const transferClass = () => screen.getByLabelText('Share class') as HTMLSelectElement;
  await screen.findByRole('link', { name: 'Transfer shares' });
  const transferLink = () => screen.getByRole('link', { name: 'Transfer shares' });
  const issueLink = () => screen.getByRole('link', { name: 'Issue shares' });
  const correctionsLink = () => screen.getByRole('link', { name: 'Corrections' });
  expect(screen.queryByRole('link', { name: 'History' })).toBeNull();
  const openTransfer = () => screen.getByRole('button', { name: /^Review and approve [(]transfer/ });
  await screen.findByRole('button', { name: /^Review and approve [(]transfer/ });
  expect(screen.queryByRole('button', { name: /^Apply [(]transfer/ })).toBeNull();
  const transferDecisionUrl = URLS.REGISTER_TRANSFER_DECIDE(transfer.uuid);
  const transferDecisionCalls = () => api.post.mock.calls.filter(([url]) => url === transferDecisionUrl);
  fireEvent.click(openTransfer());
  const transferReview = await screen.findByRole('region', { name: 'Review share transfer' });
  expect(screen.queryByRole('dialog')).toBeNull();
  const transferImpact = await within(transferReview).findByRole('table', { name: 'Transfer ownership impact' });
  expect(
    within(within(transferImpact).getByRole('row', { name: /Synthetic Transferor/ })).getByText('90 shares'),
  ).toBeTruthy();
  expect(
    within(within(transferImpact).getByRole('row', { name: /Synthetic Recipient/ })).getByText('10 shares'),
  ).toBeTruthy();
  expect(document.activeElement).toBe(within(transferReview).getByRole('heading', { name: 'Review share transfer' }));
  expect(transferClass().disabled).toBe(true);
  expect(issueLink().getAttribute('aria-disabled')).toBe('true');
  expect(correctionsLink().getAttribute('aria-disabled')).toBe('true');
  expect(transferDecisionCalls()).toHaveLength(0);
  expect(transfer.registerEntry).toBeNull();
  fireEvent.click(within(transferReview).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(document.activeElement).toBe(openTransfer()));
  expect(screen.queryByRole('region', { name: 'Review share transfer' })).toBeNull();
  expect(transferDecisionCalls()).toHaveLength(0);
  fireEvent.click(openTransfer());
  const confirmationReview = await screen.findByRole('region', { name: 'Review share transfer' });
  const transferConfirm = within(confirmationReview).getByRole('button', { name: 'Approve' });
  await waitFor(() => expect(transferConfirm.matches(':disabled')).toBe(false));
  fireEvent.click(transferConfirm);
  await within(confirmationReview).findByRole('button', { name: 'Recover original decision receipt' });
  expect(transfer.decisions).toHaveLength(2);
  expect(transfer.registerEntry).toBe('transfer-entry-a');
  expect(transfer.effectiveOn).toBe(transfer.companyEventOn);
  expect(transfer.stage).toBe('applied');
  expect(transferMovements).toBe(1);
  const cancelTransferReview = within(confirmationReview).getByRole('button', { name: 'Cancel' });
  await waitFor(() => expect(cancelTransferReview.matches(':disabled')).toBe(false));
  fireEvent.click(cancelTransferReview);
  await screen.findByRole('button', { name: /^Recover approve receipt [(]transfer/ });
  expect(transferClass().disabled).toBe(true);
  expect(issueLink().getAttribute('aria-disabled')).toBe('true');
  expect(screen.getByRole('link', { name: /^Documents$/ }).getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(screen.getByRole('link', { name: /^Documents$/ }));
  expect(screen.getByRole('heading', { level: 1, name: 'Transfer shares' })).toBeTruthy();
  expect(screen.getByRole('button', { name: /^Recover approve receipt [(]transfer/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Expand Documents navigation' }));
  expect(screen.getByRole('link', { name: 'Certificates' }).getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(screen.getByRole('link', { name: 'Ledger exports' }));
  expect(await screen.findByRole('heading', { level: 1, name: 'Ledger exports' })).toBeTruthy();
  expect(transferLink().getAttribute('aria-disabled')).toBeNull();
  fireEvent.click(transferLink());
  expect(await screen.findByRole('heading', { level: 1, name: 'Transfer shares' })).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: /^Recover approve receipt [(]transfer/ }));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: /^Recover approve receipt [(]transfer/ })).toBeNull(),
  );
  expect(transferDecisionCalls()).toHaveLength(2);
  expect(transferDecisionCalls()[1][1]).toEqual(transferDecisionCalls()[0][1]);
  expect(transferDecisionCalls()[0][1]).toMatchObject({
    kind: 'approve',
    appointment: APPOINTMENT.uuid,
    completeTransfer: true,
    applyAppointment: 'transfer-apply',
  });
  expect(transferDecisionCalls().every(([, body]) => body.kind === 'approve')).toBe(true);
  expect(transfer.decisions).toHaveLength(2);
  expect(transfer.registerEntry).toBe('transfer-entry-a');
  expect(transferMovements).toBe(1);
  expect(screen.queryByRole('button', { name: /^Apply [(]transfer/ })).toBeNull();
  await waitFor(() => expect(transferClass().disabled).toBe(false));
  cleanup();
  client.clear();
  transfer = {
    ...transfer,
    uuid: 'transfer-b',
    stage: 'approved',
    status: 'submitted',
    registerEntry: null,
    effectiveOn: null,
    reviewedAt: null,
    reviewedBy: null,
    decisions: [
      {
        ...transfer.decisions[0],
        uuid: 'prior-approval-b',
        idempotencyKey: 'prior-approval-b',
      },
    ],
  };
  const transferGet = api.get.getMockImplementation()!;
  api.get.mockImplementation(async (url, config?: { params?: { token?: string } }) => {
    if (url === URLS.REGISTER)
      return {
        data: {
          results: [
            { uuid: REGISTER.token.uuid, companyUuid: APPOINTMENT.company, companyName: APPOINTMENT.companyName },
          ],
          next: null,
        },
      };
    return transferGet(url, config);
  });
  renderCompanyPage(
    client,
    <LedgerNavigationProvider>
      <CompanyContextProvider>
        <Sidebar />
        <CompanyRegisterPage />
      </CompanyContextProvider>
    </LedgerNavigationProvider>,
    'Ledger',
    { entry: '/company/ledger#transfer', path: '/company/ledger' },
  );
  await screen.findByText('Ready to complete');
  fireEvent.click(await screen.findByRole('button', { name: /^Review and approve [(]transfer/ }));
  await screen.findByRole('region', { name: 'Review share transfer' });
  expect(screen.queryByLabelText('Share class')).toBeNull();
  const soleClassLabel = `${REGISTER.token.name} · ${REGISTER.token.symbol}`;
  expect(screen.getAllByText(soleClassLabel).filter((element) => !element.closest('[hidden]'))).toHaveLength(1);
  expect(
    within(screen.getByRole('region', { name: 'Share transfer workflow' })).queryByRole('heading', {
      name: 'Share transfers',
    }),
  ).toBeNull();
  expect(transferDecisionCalls()).toHaveLength(2);
  expect(transferMovements).toBe(1);
  expect(transfer.registerEntry).toBeNull();
});
