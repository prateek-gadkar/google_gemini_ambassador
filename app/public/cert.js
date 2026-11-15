'use strict';

var MAX_PIXELS = 12 * 1000 * 1000;

function $(id) { return document.getElementById(id); }

function showBanner(text, kind) {
  var node = $('certMsg');
  node.className = 'banner ' + (kind || 'warn');
  node.textContent = text;
  node.classList.remove('hidden');
}

function hideBanner() {
  $('certMsg').classList.add('hidden');
}

function getIssued(name) {
  return fetch('/api/certificate/issue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ name: name }),
  }).then(function (res) {
    return res.json().catch(function () { return {}; }).then(function (data) {
      if (!res.ok) throw new Error(data.error || 'Could not issue the certificate.');
      return data;
    });
  });
}

function loadImage(src) {
  return new Promise(function (resolve, reject) {
    var img = new Image();
    img.onload = function () { resolve(img); };
    img.onerror = function () { reject(new Error('The certificate artwork could not be loaded.')); };
    img.src = src;
  });
}

function prepare() {
  var params = new URLSearchParams(window.location.search);
  var typed = (params.get('name') || '').trim();

  if (!typed) {
    showBanner('Open this page from your dashboard and type your name there.', 'warn');
    $('certStatus').textContent = 'No name supplied';
    return;
  }

  $('certStatus').textContent = 'Checking your registration...';

  getIssued(typed)
    .then(function (data) {
      $('certStatus').textContent = 'Drawing your certificate...';
      return loadImage(data.render.templateUrl).then(function (img) {
        return { data: data, img: img };
      });
    })
    .then(function (bundle) {
      var img = bundle.img;
      var data = bundle.data;
      var width = img.naturalWidth || img.width;
      var height = img.naturalHeight || img.height;

      // Keep the canvas inside browser memory limits while preserving the
      // template's aspect ratio.
      var scale = Math.min(1, Math.sqrt(MAX_PIXELS / (width * height)));
      var outW = Math.round(width * scale);
      var outH = Math.round(height * scale);

      var canvas = $('canvas');
      canvas.width = outW;
      canvas.height = outH;
      var ctx = canvas.getContext('2d');

      var nameCfg = Object.assign({}, data.render.name);
      var placement = window.CertRender.drawCertificate(ctx, img, data.cert.name, nameCfg);

      $('certMeta').textContent =
        data.cert.serial + ' · ' + new Date(data.cert.issuedAt).toLocaleDateString() +
        ' · ' + outW + 'x' + outH + 'px';
      $('certStatus').textContent = 'Ready';
      $('btnDownload').disabled = false;
      hideBanner();

      $('btnDownload').onclick = function () {
        var button = $('btnDownload');
        button.disabled = true;
        canvas.toBlob(function (blob) {
          if (!blob) {
            showBanner('Your browser could not export the image. Try a different browser.', 'bad');
            button.disabled = false;
            return;
          }
          var url = URL.createObjectURL(blob);
          var link = document.createElement('a');
          var safe = data.cert.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
          link.href = url;
          link.download = 'certificate-' + (safe || 'student') + '.png';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
          button.disabled = false;
        }, 'image/png');
      };

      // Leaving a trace is useful when debugging a print misalignment.
      if (window.console && console.info) {
        console.info('certificate placement', placement);
      }
    })
    .catch(function (err) {
      $('certStatus').textContent = 'Not available';
      showBanner(err.message, 'bad');
    });
}

prepare();
