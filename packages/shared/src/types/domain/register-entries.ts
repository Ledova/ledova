import type { ApiQuery, ApiSchema } from '../contracts';

export type RegisterEntry = ApiSchema<'ShareRegisterEntry'>;
export type RegisterEntryChange = ApiSchema<'ShareRegisterEntryChange'>;
export type RegisterEntryKind = ApiSchema<'ShareRegisterEntryKindEnum'>;
export type RegisterEntryQueryParams = ApiQuery<'api_v1_tokens_register_entries_list'>;
