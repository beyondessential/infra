/* eslint-disable no-var,prefer-destructuring */

// eslint-disable-next-line no-unused-vars
function handler(event) {
  var request = event.request;
  var headers = event.response.headers;
  var uri = request.uri;

  // Order matters!

  // only allow HEAD for CORS requests, so things can check if a URL exists
  // but not hotlink to it
  if (!headers['access-control-allow-origin']) {
    headers['access-control-allow-origin'] = { value: '*' };
    headers['access-control-allow-methods'] = { value: 'HEAD, OPTIONS' };
  }

  // https://host/path/ -> rewrite to https://host/path/index.html
  if (uri.endsWith('/')) {
    request.uri += 'index.html';
    return request;
  }

  // https://host/path -> redirect to https://host/path/
  if (!uri.includes('.')) {
    return {
      statusCode: 307,
      statusDescription: 'Temporary Redirect',
      headers: {
        location: { value: `${request.uri}/` },
      },
    };
  }

  return request;
}
