import axios from 'axios';
import {
  getRegisterPauseChanges,
  getRegisterPauseChange,
  prepareRegisterPauseChange,
  previewRegisterPauseChangeDecision,
  decideRegisterPauseChange,
  downloadRegisterPauseChangeFile,
} from '../../src/services/register-pause-changes';
import { COMPANY_TOKEN_ENDPOINTS as URLS } from '../../src/constants/api';
afterEach(() => jest.restoreAllMocks());
it('uses all six actual pause operations while retaining full request bodies and current transport/session guards', async () => {
  const api = axios.create(),
    get = jest.spyOn(api, 'get').mockResolvedValue({ data: {} }),
    post = jest.spyOn(api, 'post').mockResolvedValue({ data: {} });
  const config = { ledovaSessionEpoch: 4, ledovaSubmissionGuard: () => undefined };
  const body = {
    operationId: 'original',
    appointment: 'appointment',
    token: 'class',
    paused: false,
    reason: 'Resume company share operations',
    authorityReference: 'BOARD-1',
    authorityEvidence: 'authority',
  };
  const preview = { appointment: 'appointment', kind: 'apply' as const, reason: '' },
    decision = { ...preview, idempotencyKey: 'same-key', previewDigest: 'd'.repeat(64), confirmation: true };
  await getRegisterPauseChanges(api, { company: 'company', token: 'class', page: 2 }, config);
  await getRegisterPauseChange(api, 'original', config);
  await prepareRegisterPauseChange(api, body, config);
  await previewRegisterPauseChangeDecision(api, 'original', preview, config);
  await decideRegisterPauseChange(api, 'original', decision, config);
  await downloadRegisterPauseChangeFile(api, 'original', config);
  expect(get.mock.calls).toEqual([
    [URLS.REGISTER_PAUSE_CHANGES, { ...config, params: { company: 'company', token: 'class', page: 2 } }],
    [URLS.REGISTER_PAUSE_CHANGE('original'), config],
    [URLS.REGISTER_PAUSE_CHANGE_FILE('original'), { ...config, responseType: 'blob' }],
  ]);
  expect(post.mock.calls).toEqual([
    [URLS.REGISTER_PAUSE_CHANGES, body, config],
    [URLS.REGISTER_PAUSE_CHANGE_PREVIEW('original'), preview, config],
    [URLS.REGISTER_PAUSE_CHANGE_DECIDE('original'), decision, config],
  ]);
});
