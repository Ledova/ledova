export const REGISTER_AWARD_COPY = {
  TITLE: 'Employee awards',
  PREPARE: 'Record an employee award',
  SUBMIT: 'Record award',
  EMPTY: 'No employee award has been recorded for this share class.',
  READ_ONLY_NOTE: 'Recording award changes needs current company administration or register preparation authority.',
  SHARES: 'Promised shares',
  TERMS: 'Agreement terms',
  SCHEDULE: 'Recorded vesting schedule',
  ENDED_UNVESTED: 'Unvested rights ended',
  ENDED_VESTED: 'Vested rights ended',
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
  RECOVERY_NOTE: 'If the response is interrupted, retry the same recorded request before starting another.',
  RECORDING_FAILED: 'The award response could not be confirmed. Refresh the awards and retry the same request.',
  VESTING_FAILED: 'The vesting response could not be confirmed. Refresh the events and retry the same request.',
};

export const REGISTER_AWARD_UNMET_COPY: Record<string, string> = {
  imported_non_tokenised_register_required:
    'Employee awards need an opened, imported register for a draft share class without a deployed contract.',
};
