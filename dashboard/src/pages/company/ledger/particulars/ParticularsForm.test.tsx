// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { REGISTER_PARTICULARS_COPY, type OrderSubmissionOwner, type OwnCompanyAppointment } from '@ledova/shared';
import { ParticularsForm } from './ParticularsForm';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));

const owner = { userUuid: 'user', ownerAccountUuid: 'account' } as unknown as OrderSubmissionOwner;
const appointment = {
  uuid: 'appointment',
  company: 'company',
  capabilities: ['admin'],
  status: 'active',
  isEffective: true,
} as unknown as OwnCompanyAppointment;

type Particulars = { name: string; address: string };

function Landed() {
  const location = useLocation();
  return <p data-testid="landed">{JSON.stringify({ path: location.hash, state: location.state })}</p>;
}

afterEach(() => {
  cleanup();
  api.post.mockReset();
});

it("keeps an edit's baseline after a conflict until the editor loads the current particulars, then saves over them", async () => {
  const client = new QueryClient();
  const original = { name: 'Old Name', address: '1 Old Street' };
  const theirs = { name: 'Old Name', address: '2 Their Street' };
  const onConflict = vi.fn();
  const tree = (particulars: Particulars) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/edit']}>
        <Routes>
          <Route
            path="/edit"
            element={
              <ParticularsForm
                owner={owner}
                guard={() => {}}
                company="company"
                member="member"
                appointment={appointment}
                current={particulars}
                recorded={particulars}
                blocked={false}
                onConflict={onConflict}
                onMissing={() => {}}
              />
            }
          />
          <Route path="*" element={<Landed />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(original));
  const name = screen.getByLabelText(REGISTER_PARTICULARS_COPY.NAME) as HTMLInputElement;
  const address = screen.getByLabelText(REGISTER_PARTICULARS_COPY.RESIDENTIAL_ADDRESS) as HTMLTextAreaElement;
  fireEvent.change(name, { target: { value: 'My New Name' } });
  view.rerender(tree(theirs));
  api.post.mockRejectedValueOnce({ response: { status: 409, data: { detail: 'This member changed.' } } });
  fireEvent.click(screen.getByRole('button', { name: REGISTER_PARTICULARS_COPY.SUBMIT }));
  const reload = await screen.findByRole('button', { name: REGISTER_PARTICULARS_COPY.RELOAD });
  expect(onConflict).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(reload);
  expect(api.post.mock.calls[0][1].expected).toEqual({ name: 'Old Name', residentialAddress: '1 Old Street' });
  const save = screen.getByRole('button', { name: REGISTER_PARTICULARS_COPY.SUBMIT }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  view.rerender(tree(theirs));
  fireEvent.submit(save.closest('form')!);
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(address.value).toBe('1 Old Street');
  fireEvent.click(reload);
  expect(document.activeElement).toBe(name);
  expect(name.value).toBe('Old Name');
  expect(address.value).toBe('2 Their Street');
  expect(screen.queryByRole('button', { name: REGISTER_PARTICULARS_COPY.RELOAD })).toBeNull();
  fireEvent.change(name, { target: { value: 'My New Name' } });
  api.post.mockImplementationOnce(async (_url: string, body: Record<string, unknown>) => ({
    data: {
      uuid: body.operationId,
      preparingAppointment: 'appointment',
      member: 'member',
      name: 'My New Name',
      residentialAddress: '2 Their Street',
      reason: '',
      previousParticulars: { name: 'Old Name', residentialAddress: '2 Their Street', asAt: '2026-11-01' },
      status: 'applied',
      providedBy: 'company',
    },
  }));
  fireEvent.click(screen.getByRole('button', { name: REGISTER_PARTICULARS_COPY.SUBMIT }));
  const landed = JSON.parse((await screen.findByTestId('landed')).textContent!);
  const second = api.post.mock.calls[1][1];
  expect(second.expected).toEqual({ name: 'Old Name', residentialAddress: '2 Their Street' });
  expect(second.residentialAddress).toBe('2 Their Street');
  expect(second.operationId).not.toBe(api.post.mock.calls[0][1].operationId);
  expect(landed.state.registerRecord).toBe(second.operationId);
});
