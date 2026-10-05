import axios from 'axios';
import { uploadRegisterEvidence } from '../../src/services/register-commands';
import type { RegisterEvidenceKind } from '../../src/types';

afterEach(() => jest.restoreAllMocks());

it.each<RegisterEvidenceKind>(['share_register', 'asic_extract', 'authority'])(
  'uploads one %s file as multipart with the company, appointment, kind and retry key',
  async (kind) => {
    const api = axios.create();
    const post = jest.spyOn(api, 'post').mockResolvedValue({ data: {} });
    const file = new Blob(['%PDF'], { type: 'application/pdf' });
    const session = { timeout: 1000, ledovaSessionEpoch: 3 };
    await uploadRegisterEvidence(
      api,
      { companyId: 'company-a', appointment: 'appointment-a', kind, idempotencyKey: 'key-a', file },
      session,
    );
    const [path, form, config] = post.mock.calls[0] as [string, FormData, Record<string, unknown>];
    expect(path).toBe('/api/v1/tokens/register-evidence/');
    expect(['company_id', 'appointment', 'kind', 'idempotency_key'].map((name) => [name, form.get(name)])).toEqual([
      ['company_id', 'company-a'],
      ['appointment', 'appointment-a'],
      ['kind', kind],
      ['idempotency_key', 'key-a'],
    ]);
    expect(form.get('file')).toBeInstanceOf(Blob);
    expect(config).toEqual({ ...session, headers: { 'Content-Type': 'multipart/form-data' } });
  },
);
