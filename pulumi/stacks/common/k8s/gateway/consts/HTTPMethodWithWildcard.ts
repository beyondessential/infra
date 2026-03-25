/**
 * Either one HTTP Method, or all of them.
 */
export const HTTPMethodWithWildcard = {
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  DELETE: 'DELETE',
  PATCH: 'PATCH',
  OPTIONS: 'OPTIONS',
  HEAD: 'HEAD',
  ALL: '*',
} as const;
export type HTTPMethodWithWildcard =
  (typeof HTTPMethodWithWildcard)[keyof typeof HTTPMethodWithWildcard];
