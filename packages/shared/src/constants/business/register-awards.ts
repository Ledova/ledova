export const REGISTER_AWARD_COPY = {
  TITLE: 'Employee awards',
  NOTE: 'A promised award is separate from issued shares. Dates and the recorded schedule do not vest or issue shares automatically.',
  PREPARE: 'Record an employee award',
  SUBMIT: 'Record award',
  EMPTY: 'No employee award has been recorded for this share class.',
  READ_ONLY_NOTE: 'Recording award changes needs current company administration or register preparation authority.',
  SHARES: 'Promised shares',
  TERMS_ON: 'Agreement dated on',
  TERMS: 'Agreement terms',
  SCHEDULE: 'Recorded vesting schedule',
  AGREEMENT_DOCUMENT: 'Agreement document',
  VEST: 'Record a vesting event',
  VESTING_SHARES: 'Shares vested in this event',
  VESTED_ON: 'Company-recorded vesting date',
  VESTING_DOCUMENT: 'Vesting evidence',
  VESTING_NOTE:
    'The company records this event. A separate approved non-paid grant is required to issue the vested shares.',
  PROMISED: 'Promised',
  VESTED: 'Company-recorded vested',
  ISSUED: 'Issued through grants',
  AVAILABLE: 'Vested and not yet issued',
  ENDED_UNVESTED: 'Unvested rights ended',
  ENDED_VESTED: 'Vested rights ended',
  UNVESTED_REMAINING: 'Unvested rights remaining',
  REMAINING_UNISSUED: 'Unissued rights remaining',
  END: 'End unissued rights',
  REVERSE: 'Correct a vesting event',
  END_NOTE:
    'Record the company’s evidenced decision to end unvested or vested-but-unissued rights. Issued shares and earlier records remain unchanged.',
  REVERSAL_NOTE:
    'Reverse an evidenced quantity from one original vesting event. Issued shares and the original event remain unchanged.',
  END_UNVESTED: 'Unvested rights to end',
  END_VESTED: 'Vested rights to end',
  REVERSED_SHARES: 'Shares to reverse',
  COMPANY_EVENT_ON: 'Company event date',
  REASON: 'Company reason',
  ADJUSTMENT_DOCUMENT: 'Supporting evidence',
  ADJUSTMENT_FAILED:
    'The award adjustment response could not be confirmed. Recover the same request before recording another.',
  MEMBER_RECORDS_FAILED: 'Your award records could not be confirmed. Refresh before continuing.',
  PREPARE_GRANT: 'Prepare a grant from this award',
  RECOVERY_NOTE: 'If the response is interrupted, retry the same recorded request before starting another.',
  RECORDING_FAILED: 'The award response could not be confirmed. Refresh the awards and retry the same request.',
  VESTING_FAILED: 'The vesting response could not be confirmed. Refresh the events and retry the same request.',
};

export const REGISTER_AWARD_UNMET_COPY: Record<string, string> = {
  imported_non_tokenised_register_required:
    'Employee awards need an opened, imported register for a draft share class without a deployed contract.',
};
