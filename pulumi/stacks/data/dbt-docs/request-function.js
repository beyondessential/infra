/* eslint-disable no-var,prefer-destructuring */

// eslint-disable-next-line no-unused-vars
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  // Order matters!

  // https://host/project/ -> redirect to https://host/project/latest/
  if (/^\/\w+\/$/.test(uri)) {
    return {
      statusCode: 307,
      statusDescription: 'Temporary Redirect',
      headers: {
        location: { value: `${request.uri}latest/` },
      },
    };
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
