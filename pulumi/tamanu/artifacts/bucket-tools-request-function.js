function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (/^\/linux-images\/[^/]+$/.test(uri)) {
    return {
      statusCode: 307,
      statusDescription: 'Temporary Redirect',
      headers: {
        location: { value: uri + '/' },
      },
    };
  }

  if (/^\/linux-images\/[^/]+\/$/.test(uri)) {
    request.uri += 'index.html';
    return request;
  }

  return request;
}
