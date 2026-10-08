import axios from 'axios';
import {
  getRegisterPaidIssues,
  getRegisterPaidIssueSubscriptions,
  getRegisterPaidIssue,
  prepareRegisterPaidIssue,
  previewRegisterPaidIssueDecision,
  decideRegisterPaidIssue,
  downloadRegisterPaidIssueFile,
} from '../../src/services/register-paid-issues';
import { COMPANY_TOKEN_ENDPOINTS as URLS } from '../../src/constants/api';
afterEach(() => jest.restoreAllMocks());
it('uses all seven actual paid issue operations while retaining full request bodies and current transport/session guards', async () => {
  const api = axios.create(),
    get = jest.spyOn(api, 'get').mockResolvedValue({ data: {} }),
    post = jest.spyOn(api, 'post').mockResolvedValue({ data: {} });
  const config = { ledovaSessionEpoch: 4, ledovaSubmissionGuard: () => undefined };
  const body = {
    operationId: 'original',
    appointment: 'appointment',
    subscription: 'subscription',
    approvingDirector: 'Synthetic Director',
    reason: 'Approve recorded paid allotment',
    authorityReference: 'BOARD-1',
    authorityEvidence: 'authority',
  };
  const preview = { appointment: 'appointment', kind: 'apply' as const, reason: '' },
    decision = { ...preview, idempotencyKey: 'same-key', previewDigest: 'd'.repeat(64), confirmation: true };
  await getRegisterPaidIssues(api, { company: 'company', token: 'class', page: 2 }, config);
  await getRegisterPaidIssueSubscriptions(api, { company: 'company', token: 'class' }, config);
  await getRegisterPaidIssue(api, 'original', config);
  await prepareRegisterPaidIssue(api, body, config);
  await previewRegisterPaidIssueDecision(api, 'original', preview, config);
  await decideRegisterPaidIssue(api, 'original', decision, config);
  await downloadRegisterPaidIssueFile(api, 'original', config);
  expect(get.mock.calls).toEqual([
    [URLS.REGISTER_PAID_ISSUES, { ...config, params: { company: 'company', token: 'class', page: 2 } }],
    [URLS.REGISTER_PAID_ISSUE_SUBSCRIPTIONS, { ...config, params: { company: 'company', token: 'class' } }],
    [URLS.REGISTER_PAID_ISSUE('original'), config],
    [URLS.REGISTER_PAID_ISSUE_FILE('original'), { ...config, responseType: 'blob' }],
  ]);
  expect(post.mock.calls).toEqual([
    [URLS.REGISTER_PAID_ISSUES, body, config],
    [URLS.REGISTER_PAID_ISSUE_PREVIEW('original'), preview, config],
    [URLS.REGISTER_PAID_ISSUE_DECIDE('original'), decision, config],
  ]);
});
