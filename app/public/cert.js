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

/** Today's date, written exactly as configured in config.js. */
function formatDate(spec) {
  var options = (spec && spec.options) || { day: 'numeric', month: 'long', year: 'numeric' };
  var locale = (spec && spec.locale) || 'en-GB';
  try {
    return new Intl.DateTimeFormat(locale, options).format(new Date());
  } catch (err) {
    return new Date().toISOString().slice(0, 10);
  }
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
      var render = data.render;
      var jobs = [loadImage(render.templateUrl)];
      if (render.signatureUrl) jobs.push(loadImage(render.signatureUrl));
      return Promise.all(jobs).then(function (images) {
        return { data: data, template: images[0], signature: images[1] || null };
      });
    })
    .then(function (bundle) {
      var data = bundle.data;
      var render = data.render;
      var template = bundle.template;
      var width = template.naturalWidth || template.width;
      var height = template.naturalHeight || template.height;

      // Keep the canvas inside browser memory limits while preserving the
      // template's aspect ratio.
      var scale = Math.min(1, Math.sqrt(MAX_PIXELS / (width * height)));
      var outW = Math.round(width * scale);
      var outH = Math.round(height * scale);

      var canvas = $('canvas');
      canvas.width = outW;
      canvas.height = outH;
      var ctx = canvas.getContext('2d');

      // Draw at full template resolution: scale the context, not the maths, so
      // every measured fraction stays exact.
      ctx.setTransform(scale, 0, 0, scale, 0, 0);

      var dateText = formatDate(render.dateFormat);
      var placement = window.CertRender.drawCertificate(
        ctx,
        template,
        {
          name: data.cert.name,
          date: dateText,
          signatureImage: bundle.signature,
        },
        render.fields
      );
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      $('certMeta').textContent =
        data.cert.serial + ' · ' + dateText + ' · ' + outW + 'x' + outH + 'px';
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
