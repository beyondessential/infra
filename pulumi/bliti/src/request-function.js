/* eslint-disable no-var,prefer-destructuring */

// Viewer-request function for the bliti web app.
// Kept to ES5 for the cloudfront-js-1.0 runtime; tested by functions.test.ts.

// spec: BLWEB#addresses
var APEX = 'iti.tamanu.app';
var PROD_PREFIX = 'prod/';
var PREVIEW_HOST = /^pr-([1-9][0-9]*)\.iti\.tamanu\.app$/;

// spec: BLWEB#pre-compressed-variants
var COMPRESSIBLE = /\.(html|js|mjs|css|json|svg|wasm|webmanifest)$/;
var CODINGS = [
  { coding: 'zstd', suffix: '.zst' },
  { coding: 'br', suffix: '.br' },
  { coding: 'gzip', suffix: '.gz' },
];

function headerValue(header) {
  if (!header) {
    return '';
  }
  if (header.multiValue) {
    return header.multiValue
      .map(function (entry) {
        return entry.value;
      })
      .join(',');
  }
  return header.value;
}

function prefixFor(host) {
  if (host === APEX) {
    return PROD_PREFIX;
  }
  var preview = PREVIEW_HOST.exec(host);
  if (preview) {
    return 'previews/pr-' + preview[1] + '/';
  }
  return null;
}

function queryString(querystring) {
  var parts = [];
  Object.keys(querystring).forEach(function (key) {
    var entry = querystring[key];
    (entry.multiValue || [entry]).forEach(function (value) {
      parts.push(key + '=' + value.value);
    });
  });
  return parts.length ? '?' + parts.join('&') : '';
}

// Whether each coding of an Accept-Encoding is acceptable, with `*` standing for
// every coding not named (RFC 9110 section 12.5.3).
function acceptable(acceptEncoding) {
  var named = {};
  var wildcard = false;
  acceptEncoding.split(',').forEach(function (member) {
    var params = member.split(';');
    var coding = params[0].trim().toLowerCase();
    if (!coding) {
      return;
    }
    var weight = 1;
    for (var i = 1; i < params.length; i++) {
      var param = params[i].trim().toLowerCase();
      if (param.indexOf('q=') === 0) {
        weight = parseFloat(param.slice(2));
      }
    }
    var accepted = weight > 0;
    if (coding === '*') {
      wildcard = accepted;
    } else {
      named[coding] = accepted;
    }
  });
  return function (coding) {
    return Object.prototype.hasOwnProperty.call(named, coding) ? named[coding] : wildcard;
  };
}

// eslint-disable-next-line no-unused-vars
function handler(event) {
  var request = event.request;
  var host = headerValue(request.headers.host).toLowerCase().replace(/:\d+$/, '');
  var uri = request.uri;

  var prefix = prefixFor(host);
  if (prefix === null) {
    return { statusCode: 404, statusDescription: 'Not Found' };
  }

  // spec: BLWEB#routing
  if (uri !== '/' && uri.endsWith('/')) {
    return {
      statusCode: 308,
      statusDescription: 'Permanent Redirect',
      headers: {
        location: { value: (uri.replace(/\/+$/, '') || '/') + queryString(request.querystring) },
      },
    };
  }

  var path;
  if (uri === '/') {
    path = '/index.html';
  } else if (uri.slice(uri.lastIndexOf('/') + 1).indexOf('.') === -1) {
    path = uri + '.html';
  } else {
    path = uri;
  }
  var key = '/' + prefix + path.slice(1);

  // spec: BLWEB#pre-compressed-variants
  if (COMPRESSIBLE.test(key)) {
    var accepts = acceptable(headerValue(request.headers['accept-encoding']));
    for (var i = 0; i < CODINGS.length; i++) {
      if (accepts(CODINGS[i].coding)) {
        key += CODINGS[i].suffix;
        break;
      }
    }
  }

  request.uri = key;
  return request;
}
