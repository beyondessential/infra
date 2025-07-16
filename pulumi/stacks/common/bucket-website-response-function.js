/* eslint-disable no-var,prefer-destructuring */

// eslint-disable-next-line no-unused-vars
function handler(event) {
  var response = event.response;
  var headers = response.headers;

  // Allow HEAD for CORS requests, so things can check if a URL exists;
  // but don't allow GET so direct hotlinking doesn't work.
  if (!headers['access-control-allow-origin']) {
    headers['access-control-allow-origin'] = { value: '*' };
  }
  if (!headers['access-control-allow-methods']) {
    headers['access-control-allow-methods'] = { value: 'HEAD, OPTIONS' };
  }

  return response;
}
