/* eslint-disable no-var,prefer-destructuring */

// Viewer-response function for the bliti web app.
// Kept to ES5 for the cloudfront-js-1.0 runtime; tested by functions.test.ts.

// spec: BLWEB#pre-compressed-variants
// Every response carries Vary: Accept-Encoding, which covers each one served from a variant
// without the function having to work out which object the request was served from.
// eslint-disable-next-line no-unused-vars
function handler(event) {
  var response = event.response;
  var headers = response.headers;
  var vary = headers.vary ? headers.vary.value : '';

  if (!/(^|,)\s*(accept-encoding|\*)\s*(,|$)/i.test(vary)) {
    headers.vary = { value: vary ? vary + ', Accept-Encoding' : 'Accept-Encoding' };
  }

  return response;
}
