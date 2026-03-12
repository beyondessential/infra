function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri.startsWith('/linux-images/')) {
    if (uri.endsWith('/')) {
      request.uri += 'index.html';
      return request;
    }

    if (!uri.includes('.')) {
      return {
        statusCode: 307,
        statusDescription: 'Temporary Redirect',
        headers: {
          location: { value: request.uri + '/' },
        },
      };
    }
  }

  return request;
}
