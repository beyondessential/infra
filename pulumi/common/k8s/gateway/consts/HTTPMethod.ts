/**
 * Any one HTTP Method.
 */
export const HTTPMethod = {
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  DELETE: 'DELETE',
  PATCH: 'PATCH',
  OPTIONS: 'OPTIONS',
  HEAD: 'HEAD',
} as const;
export type HTTPMethod = (typeof HTTPMethod)[keyof typeof HTTPMethod];

/**
 * Either one HTTP Method, or all of them.
 */
export const HTTPMethodWithWildcard = {
  ...HTTPMethod,
  ALL: '*',
} as const;
export type HTTPMethodWithWildcard =
  (typeof HTTPMethodWithWildcard)[keyof typeof HTTPMethodWithWildcard];
