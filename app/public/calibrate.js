'use strict';

var KEY_STORE = 'gsa-admin-key';
var SAMPLE_NAME = 'Ananya Sharma';

var key = sessionStorage.getItem(KEY_STORE) || '';
var state = {
  template: null,
  signature: null,
  cfg: null,
  dateFormat: null,
  active: 'name',
  templateReady: false,
  signatureReady: false,
};

function $(id) { return document.getElementById(id); }

function adminFetch(path, options) {
  var opts = options || {};
  return fetch(path, {
    method: opts.method || 'GET',
    headers: Object.assign({ 'x-admin-key': key }, { 'Content-Type': 'application/json' }),
    credentials: 'same-origin',
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }).then(function (res) {
    return res.json().catch(function () { return {}; }).then(function (data) {
      if (!res.ok) throw new Error(data.error || 'Request failed (' + res.status + ')');
      return data;
    });
  });
}

function bannerIcon(kind) {
  if (kind === 'ok') return 'check_circle';
  if (kind === 'bad') return 'warning';
  return 'info';
}

function banner(text, kind) {
  var node = $('msg');
  if (!text) { node.classList.add('hidden'); return; }
  node.className = 'banner ' + (kind || 'warn');
  node.innerHTML =
    '<span class="banner-ico">' + gsaIcon(bannerIcon(kind), 20) + '</span><span>' + text + '</span>';
  node.classList.remove('hidden');
}

function formatDate(spec) {
  var options = (spec && spec.options) || { day: 'numeric', month: 'long', year: 'numeric' };
  var locale = (spec && spec.locale) || 'en-GB';
  try { return new Intl.DateTimeFormat(locale, options).format(new Date()); }
  catch (err) { return new Date().toISOString().slice(0, 10); }
}

function loadImage(src) {
  return new Promise(function (resolve, reject) {
    var img = new Image();
    img.onload = function () { resolve(img); };
    img.onerror = function () { reject(new Error('Image failed to load: ' + src)); };
    img.src = src + '?v=' + Date.now();
  });
}

// ---- drawing --------------------------------------------------------------

function activeCfg() {
  return state.cfg[state.active];
}

function draw() {
  if (!state.template || !state.cfg) return;
  var canvas = $('stage');
  var width = state.template.naturalWidth || state.template.width;
  var height = state.template.naturalHeight || state.template.height;

  canvas.width = width;
  canvas.height = height;

  var ctx = canvas.getContext('2d');
  var result = window.CertRender.drawCertificate(
    ctx,
    state.template,
    {
      name: SAMPLE_NAME,
      date: formatDate(state.dateFormat),
      signatureImage: state.signature,
    },
    state.cfg
  );

  // Outline whichever field is being edited, so it is obvious what will move.
  ctx.save();
  ctx.strokeStyle = 'rgba(255,140,0,0.9)';
  ctx.lineWidth = Math.max(2, width / 900);
  ctx.setLineDash([Math.max(6, width / 220), Math.max(4, width / 380)]);

  if (state.active === 'signature') {
    var sig = result.signature;
    if (sig) {
      ctx.strokeRect(sig.x - sig.width / 2, sig.bottom - sig.height, sig.width, sig.height);
    } else {
      var place = window.CertRender.computeImagePlacement(width, height, state.cfg.signature);
      var h = place.width / 3;
      ctx.strokeRect(place.x - place.width / 2, place.bottom - h, place.width, h);
    }
  } else {
    var info = result[state.active];
    if (info) {
      ctx.font = info.font;
      var metrics = ctx.measureText(state.active === 'name' ? SAMPLE_NAME : formatDate(state.dateFormat));
      var textWidth = metrics.width || info.fontSize * 6;
      var left = info.align === 'center' ? info.x - textWidth / 2
        : info.align === 'right' ? info.x - textWidth : info.x;
      ctx.strokeRect(left - 6, info.y - info.fontSize, textWidth + 12, info.fontSize * 1.35);
    }
  }
  ctx.restore();
}

// ---- dragging -------------------------------------------------------------

function beginDrag(event) {
  var canvas = $('stage');

  function moveTo(evt) {
    var rect = canvas.getBoundingClientRect();
    var point = evt.touches ? evt.touches[0] : evt;
    var x = (point.clientX - rect.left) / rect.width;
    var y = (point.clientY - rect.top) / rect.height;
    activeCfg().x = Math.min(1, Math.max(0, x));
    activeCfg().y = Math.min(1, Math.max(0, y));
    draw();
    syncInputs();
  }

  function onMove(evt) {
    evt.preventDefault();
    moveTo(evt);
  }

  function onUp() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('touchmove', onMove);
    window.removeEventListener('touchend', onUp);
  }

  moveTo(event);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('touchend', onUp);
}

// ---- controls -------------------------------------------------------------

function isTextField() {
  return state.active === 'name' || state.active === 'date';
}

function syncInputs() {
  var text = isTextField();
  $('textControls').classList.toggle('hidden', !text);
  $('sigControls').classList.toggle('hidden', text);
  $('activeLabel').textContent = '· ' + state.active;

  Array.prototype.forEach.call($('fieldPicker').children, function (btn) {
    var on = btn.getAttribute('data-field') === state.active;
    btn.className = (on ? 'primary' : 'ghost') + ' small';
  });

  var hint = {
    name: 'Drag to place the name. It should sit centred just above the long rule, with its baseline clear of the line.',
    date: 'Drag to place the date. It should sit centred just above the short left-hand rule.',
    signature: 'Drag to place the signature. It should sit centred just above the short right-hand rule.',
  }[state.active];
  $('stageHint').textContent = hint;

  if (!text) {
    $('sigWidth').value = String(state.cfg.signature.width * 100);
    $('sigOpacity').value = String(Math.round(state.cfg.signature.opacity * 100));
    $('sigWVal').textContent = (state.cfg.signature.width * 100).toFixed(1) + '% of width';
    $('sigOVal').textContent = Math.round(state.cfg.signature.opacity * 100) + '%';
    return;
  }

  var c = activeCfg();
  $('size').value = String(c.size * 100);
  $('maxWidth').value = String(Math.round(c.maxWidth * 100));
  $('font').value = c.font;
  $('weight').value = c.weight;
  $('align').value = c.align;
  $('color').value = c.color;
  $('sizeVal').textContent = (c.size * 100).toFixed(1) + '% of height';
  $('maxVal').textContent = Math.round(c.maxWidth * 100) + '% of width';
}

function wireInputs() {
  $('stage').addEventListener('pointerdown', beginDrag);

  Array.prototype.forEach.call($('fieldPicker').children, function (btn) {
    btn.addEventListener('click', function () {
      state.active = btn.getAttribute('data-field');
      syncInputs();
      draw();
    });
  });

  ['size', 'maxWidth', 'font', 'weight', 'align', 'color'].forEach(function (id) {
    $(id).addEventListener('input', function () {
      if (!isTextField()) return;
      var c = activeCfg();
      if (id === 'size') c.size = Number(this.value) / 100;
      else if (id === 'maxWidth') c.maxWidth = Number(this.value) / 100;
      else c[id] = this.value;
      syncInputs();
      draw();
    });
  });

  $('sigWidth').addEventListener('input', function () {
    state.cfg.signature.width = Number(this.value) / 100;
    syncInputs();
    draw();
  });

  $('sigOpacity').addEventListener('input', function () {
    state.cfg.signature.opacity = Number(this.value) / 100;
    syncInputs();
    draw();
  });

  $('btnPreview').addEventListener('click', function () {
    draw();
    $('stage').toBlob(function (blob) {
      if (!blob) return;
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = 'certificate-preview.png';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }, 'image/png');
  });
}

function readiness() {
  var bits = [];
  bits.push(state.cfg && state.templateReady ? 'artwork: enabled' : 'artwork: not enabled');
  bits.push(state.signatureReady ? 'signature: uploaded' : 'signature: MISSING — download stays locked');
  bits.push(state.templateReady && state.signatureReady
    ? 'Students can download.'
    : 'Students cannot download yet.');
  $('readiness').textContent = bits.join(' · ');
}

// ---- saving ---------------------------------------------------------------

function save(templateReady) {
  if (!state.cfg) return Promise.reject(new Error('Nothing loaded yet.'));
  $('saveMsg').textContent = 'Saving...';
  $('saveMsg').className = 'msg';

  var body = {
    name: state.cfg.name,
    date: state.cfg.date,
    signature: state.cfg.signature,
  };
  if (typeof templateReady === 'boolean') body.templateReady = templateReady;

  return adminFetch('/api/admin/cert-config', { method: 'POST', body: body })
    .then(function (data) {
      state.cfg = data.cert.fields;
      state.templateReady = data.cert.templateReady;
      $('saveMsg').textContent = data.cert.ready
        ? 'Saved. Downloads are live for unlocked students.'
        : 'Saved. Downloads are still blocked (' +
          (data.cert.templateReady ? 'signature missing' : 'not enabled') + ').';
      $('saveMsg').className = 'msg ' + (data.cert.ready ? 'ok' : 'err');
      readiness();
      return data;
    })
    .catch(function (err) {
      $('saveMsg').textContent = err.message;
      $('saveMsg').className = 'msg err';
    });
}

// ---- boot -----------------------------------------------------------------

function applyServerCert(cert) {
  state.cfg = cert.fields;
  state.dateFormat = cert.dateFormat;
  state.templateReady = cert.templateReady;
  state.signatureReady = cert.signatureReady;
}

function boot() {
  if (!key) {
    $('keyPanel').classList.remove('hidden');
    $('panel').classList.add('hidden');
    return Promise.resolve();
  }
  $('keyPanel').classList.add('hidden');

  return adminFetch('/api/admin/students')
    .then(function (data) {
      applyServerCert(data.cert);
      $('panel').classList.remove('hidden');

      if (!data.cert.templateUrl) {
        banner('No artwork uploaded yet. Go back to the admin console and upload the certificate image first.', 'warn');
        $('panel').classList.add('hidden');
        return null;
      }
      if (!data.cert.signatureUrl) {
        banner('The signature is not uploaded yet, so downloads stay locked. Place the name and date now; the signature slot is marked on the preview.', 'warn');
      } else if (!data.cert.templateReady) {
        banner('Downloads are currently disabled. Place the fields, then choose "Save and enable downloads".', 'warn');
      }

      var jobs = [loadImage(data.cert.templateUrl)];
      if (data.cert.signatureUrl) jobs.push(loadImage(data.cert.signatureUrl));

      return Promise.all(jobs).then(function (images) {
        state.template = images[0];
        state.signature = images[1] || null;
        wireInputs();
        syncInputs();
        readiness();
        draw();
      });
    })
    .catch(function (err) {
      banner(err.message, 'bad');
      $('keyPanel').classList.remove('hidden');
      $('panel').classList.add('hidden');
    });
}

$('btnUnlock').addEventListener('click', function () {
  key = $('adminKey').value.trim();
  if (!key) return;
  sessionStorage.setItem(KEY_STORE, key);
  boot();
});

$('btnEnable').addEventListener('click', function () { save(true); });
$('btnSave').addEventListener('click', function () { save(); });
$('btnDisable').addEventListener('click', function () { save(false); });

boot();
