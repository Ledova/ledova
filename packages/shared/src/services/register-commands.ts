import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { COMPANY_TOKEN_ENDPOINTS } from '../constants/api';
import type { RegisterEvidence, RegisterEvidenceUpload } from '../types';

export const uploadRegisterEvidence = (
  apiClient: AxiosInstance,
  data: RegisterEvidenceUpload,
  config?: AxiosRequestConfig,
) => {
  const form = new FormData();
  form.append('company_id', data.companyId);
  form.append('appointment', data.appointment);
  form.append('kind', data.kind);
  form.append('idempotency_key', data.idempotencyKey);
  form.append('file', data.file);
  return apiClient.post<RegisterEvidence>(COMPANY_TOKEN_ENDPOINTS.REGISTER_EVIDENCE, form, {
    ...config,
    headers: { ...config?.headers, 'Content-Type': 'multipart/form-data' },
  });
};
