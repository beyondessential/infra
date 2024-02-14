/* eslint-disable no-var,prefer-destructuring */

// eslint-disable-next-line no-unused-vars
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  // Order matters!

  // https://host/path/ -> rewrite to https://host/path/index.html
  if (uri.endsWith('/')) {
    request.uri += 'index.html';
    return request;
  }

  // https://host/path -> redirect to https://host/path/
  const DOTLESS = ['/bestool/', '/caddy/'];
  if (!uri.includes('.') && !DOTLESS.some(path => uri.includes(path))) {
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
