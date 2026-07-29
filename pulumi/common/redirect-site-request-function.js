/* eslint-disable no-var,prefer-destructuring */

// Replaced with a hostname → target-URL map when the function is created.
var TARGETS = __REDIRECTS__;

// eslint-disable-next-line no-unused-vars
function handler(event) {
  var request = event.request;
  var host = request.headers.host ? request.headers.host.value.toLowerCase() : '';
  var target = TARGETS[host];

  // Only the hostnames in the map are aliased onto this distribution, so this
  // is unreachable in practice. Answering rather than falling through to the
  // origin keeps a misconfiguration from becoming a confusing origin error.
  if (!target) {
    return {
      statusCode: 404,
      statusDescription: 'Not Found',
    };
  }

  // CloudFront hands the query string over as a parsed object, so it has to be
  // put back together to be passed along.
  var query = '';
  for (var key in request.querystring) {
    var param = request.querystring[key];
    var values = param.multiValue ? param.multiValue : [param];
    for (var i = 0; i < values.length; i += 1) {
      query += (query ? '&' : '?') + encodeURIComponent(key);
      if (values[i].value !== '') {
        query += '=' + encodeURIComponent(values[i].value);
      }
    }
  }

  return {
    statusCode: 301,
    statusDescription: 'Moved Permanently',
    headers: {
      location: { value: target + request.uri + query },
    },
  };
}
