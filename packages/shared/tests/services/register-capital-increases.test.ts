import axios from 'axios';
import {
  getRegisterCapitalIncreases,
  getRegisterCapitalIncrease,
  prepareRegisterCapitalIncrease,
  previewRegisterCapitalIncreaseDecision,
  decideRegisterCapitalIncrease,
  downloadRegisterCapitalIncreaseFile,
} from '../../src/services/register-capital-increases';
import { COMPANY_TOKEN_ENDPOINTS as URLS } from '../../src/constants/api';
afterEach(() => jest.restoreAllMocks());
it('uses all six actual capital operations while retaining full request bodies and current transport/session guards', async () => {
  const api = axios.create(),
    get = jest.spyOn(api, 'get').mockResolvedValue({ data: {} }),
    post = jest.spyOn(api, 'post').mockResolvedValue({ data: {} });
  const config = { ledovaSessionEpoch: 4, ledovaSubmissionGuard: () => undefined };
  const body = {
    operationId: 'original',
    appointment: 'appointment',
    token: 'class',
    additionalShares: 25,
    newAuthorizedTotal: 1025,
    purpose: 'Company capital',
    boardResolutionReference: 'BOARD-1',
    shareholderApprovalReference: '',
    authorityEvidence: 'authority',
  };
  const preview = { appointment: 'appointment', kind: 'apply' as const, reason: '' },
    decision = { ...preview, idempotencyKey: 'same-key', previewDigest: 'd'.repeat(64), confirmation: true };
  await getRegisterCapitalIncreases(api, { company: 'company', token: 'class', page: 2 }, config);
  await getRegisterCapitalIncrease(api, 'original', config);
  await prepareRegisterCapitalIncrease(api, body, config);
  await previewRegisterCapitalIncreaseDecision(api, 'original', preview, config);
  await decideRegisterCapitalIncrease(api, 'original', decision, config);
  await downloadRegisterCapitalIncreaseFile(api, 'original', config);
  expect(get.mock.calls).toEqual([
    [URLS.REGISTER_CAPITAL_INCREASES, { ...config, params: { company: 'company', token: 'class', page: 2 } }],
    [URLS.REGISTER_CAPITAL_INCREASE('original'), config],
    [URLS.REGISTER_CAPITAL_INCREASE_FILE('original'), { ...config, responseType: 'blob' }],
  ]);
  expect(post.mock.calls).toEqual([
    [URLS.REGISTER_CAPITAL_INCREASES, body, config],
    [URLS.REGISTER_CAPITAL_INCREASE_PREVIEW('original'), preview, config],
    [URLS.REGISTER_CAPITAL_INCREASE_DECIDE('original'), decision, config],
  ]);
});
