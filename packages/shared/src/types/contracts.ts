import type { ApiComponents, ApiOperations } from '../generated/api';

export type ApiSchema<Name extends keyof ApiComponents['schemas']> = ApiComponents['schemas'][Name];

type SuccessStatus<Responses> = {
  [Status in keyof Responses]: `${Status & (string | number)}` extends `2${string}` ? Status : never;
}[keyof Responses];

type ResponseBody<Response> = Response extends { content: infer Content } ? Content[keyof Content] : void;

export type ApiResponse<Operation extends keyof ApiOperations> = ResponseBody<
  ApiOperations[Operation]['responses'][SuccessStatus<ApiOperations[Operation]['responses']>]
>;

export type ApiRequest<Operation extends keyof ApiOperations> =
  NonNullable<ApiOperations[Operation]['requestBody']> extends { content: infer Content }
    ? Content[keyof Content]
    : never;

export type ApiQuery<Operation extends keyof ApiOperations> = NonNullable<
  ApiOperations[Operation]['parameters']['query']
>;
