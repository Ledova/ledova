import { apiErrorSentence, createUserFriendlyError, readApiError, unansweredSentence } from '../../src/utils/errors';

function refusal(status: number, data: unknown) {
  return { response: { status, data }, message: `Request failed with status code ${status}` };
}

const FALLBACK = 'We could not save that. Please try again.';

describe('a field the backend named', () => {
  it('comes back as a field error, so the form can mark it', () => {
    const reading = readApiError(
      refusal(400, { acn: ['This is not a valid ACN: its last digit does not check out against the other eight.'] }),
      { fallback: FALLBACK },
    );

    expect(reading.fieldErrors).toEqual({
      acn: ['This is not a valid ACN: its last digit does not check out against the other eight.'],
    });
    expect(reading.generalError).toBeUndefined();
  });

  it('is announced instead when the form has nowhere to mark it', () => {
    const reading = readApiError(refusal(400, { primaryContact: ['Enter a contact phone number.'] }), {
      fallback: FALLBACK,
      displayedFields: ['name', 'acn'],
    });

    expect(reading.generalError).toBe('Enter a contact phone number.');
    expect(reading.fieldErrors).toBeUndefined();
  });

  it('keeps the fields the form does display while announcing the ones it does not', () => {
    const reading = readApiError(
      refusal(400, { acn: ['Company with this acn already exists.'], primaryContact: ['Missing.'] }),
      {
        fallback: FALLBACK,
        displayedFields: ['acn'],
      },
    );

    expect(reading.fieldErrors).toEqual({ acn: ['Company with this acn already exists.'] });
    expect(reading.generalError).toBe('Missing.');
  });

  it('announces non_field_errors, which belong to no field by definition', () => {
    const reading = readApiError(refusal(400, { nonFieldErrors: ['The two dates overlap.'] }), { fallback: FALLBACK });

    expect(reading.generalError).toBe('The two dates overlap.');
    expect(reading.fieldErrors).toBeUndefined();
  });
});

describe('what it refuses to say', () => {
  it('never repeats axios, whose string is about HTTP and not about the person', () => {
    const reading = readApiError(refusal(400, undefined), { fallback: FALLBACK });

    expect(reading.generalError).toBe(FALLBACK);
    expect(apiErrorSentence(refusal(400, undefined), FALLBACK)).not.toContain('status code');
  });

  it('does not read a bare string under an unrecognised key as a message for a person', () => {
    const reading = readApiError(refusal(400, { requestId: 'ab93f1', somethingNew: 'a value' }), {
      fallback: FALLBACK,
    });

    expect(reading.generalError).toBe(FALLBACK);
    expect(reading.fieldErrors).toBeUndefined();
  });

  it('does not repeat a page of markup, such as a proxy error page, as a message for a person', () => {
    const page =
      '<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body><h1>502 Bad Gateway</h1></body></html>';

    expect(readApiError(refusal(502, page), { fallback: FALLBACK }).generalError).toBe(FALLBACK);
    expect(readApiError(refusal(502, { detail: page }), { fallback: FALLBACK }).generalError).toBe(FALLBACK);
    expect(apiErrorSentence(refusal(502, page), FALLBACK)).toBe(FALLBACK);
  });

  it('still reads a plain sentence that happens to compare numbers', () => {
    expect(readApiError(refusal(400, 'Amount must be < 5 and > 1.'), { fallback: FALLBACK }).generalError).toBe(
      'Amount must be < 5 and > 1.',
    );
  });

  it('drops markup inside a field refusal and keeps the plain sentences beside it', () => {
    expect(readApiError(refusal(400, { acn: ['<b>x</b>'] }), { fallback: FALLBACK })).toEqual({
      generalError: FALLBACK,
    });
    expect(readApiError(refusal(400, { acn: ['<b>x</b>', 'Enter nine digits.'] }), { fallback: FALLBACK })).toEqual({
      fieldErrors: { acn: ['Enter nine digits.'] },
    });
  });

  it('reads a megabyte body that opens tags it never closes, in one pass', () => {
    const unclosed = '<a'.repeat(512 * 1024);

    expect(readApiError(refusal(400, unclosed), { fallback: FALLBACK }).generalError).toBe(unclosed);
    expect(readApiError(refusal(400, `${unclosed}<b>`), { fallback: FALLBACK }).generalError).toBe(FALLBACK);
  });

  it('announces once when a body carries both a label and a sentence', () => {
    const reading = readApiError(refusal(503, { error: 'Database error', detail: 'A database error occurred.' }), {
      fallback: FALLBACK,
    });

    expect(reading.generalError).toBe('A database error occurred.');
  });
});

describe('the flattened sentence, for a banner with no field to mark', () => {
  it('carries the backend reason rather than the status code', () => {
    expect(apiErrorSentence(refusal(400, { symbol: ['Symbol must contain only letters.'] }), FALLBACK)).toBe(
      'Symbol must contain only letters.',
    );
  });

  it('joins every field, because one banner is all there is', () => {
    const sentence = apiErrorSentence(
      refusal(400, { symbol: ['Symbol must contain only letters.'], totalSupply: ['Must be positive.'] }),
      FALLBACK,
    );

    expect(sentence).toContain('Symbol must contain only letters.');
    expect(sentence).toContain('Must be positive.');
  });

  it('falls back when the response says nothing at all', () => {
    expect(apiErrorSentence(new Error('network down'), FALLBACK)).toBe(FALLBACK);
  });
});

describe('a request that got no answer, when the caller says what to say then', () => {
  const NO_ANSWER = 'Network error. Please check your connection.';
  const EXPLAINED = 'Unable to connect to our servers. Please check your internet connection and try again.';

  it('keeps the sentence the app already gave the failure', () => {
    const failure = createUserFriendlyError(EXPLAINED, new Error('Network Error'));

    expect(readApiError(failure, { fallback: FALLBACK, unanswered: NO_ANSWER })).toEqual({ generalError: EXPLAINED });
    expect(apiErrorSentence(failure, FALLBACK, NO_ANSWER)).toBe(EXPLAINED);
    expect(unansweredSentence(failure, NO_ANSWER)).toBe(EXPLAINED);
  });

  it('says what the caller chose when the failure carries no sentence of its own', () => {
    const failure = Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });

    expect(readApiError(failure, { fallback: FALLBACK, unanswered: NO_ANSWER })).toEqual({ generalError: NO_ANSWER });
    expect(apiErrorSentence(failure, FALLBACK, NO_ANSWER)).toBe(NO_ANSWER);
  });

  it('still reads an answer as before', () => {
    expect(unansweredSentence(refusal(400, { detail: 'Not allowed.' }), NO_ANSWER)).toBeNull();
    expect(
      readApiError(refusal(400, { detail: 'Not allowed.' }), { fallback: FALLBACK, unanswered: NO_ANSWER }),
    ).toEqual({
      generalError: 'Not allowed.',
    });
  });

  it('says what the caller chose when the app explained the failure with no words', () => {
    const wordless = createUserFriendlyError('', new Error('Network Error'));

    expect(unansweredSentence(wordless, NO_ANSWER)).toBe(NO_ANSWER);
    expect(apiErrorSentence(wordless, FALLBACK, NO_ANSWER)).toBe(NO_ANSWER);
  });

  it('changes nothing for a caller that does not ask', () => {
    const failure = createUserFriendlyError(EXPLAINED, new Error('Network Error'));

    expect(readApiError(failure, { fallback: FALLBACK })).toEqual({ generalError: FALLBACK });
    expect(apiErrorSentence(failure, FALLBACK)).toBe(FALLBACK);
  });
});
