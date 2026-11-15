'use strict';

var KEY_STORE = 'gsa-admin-key';
var SAMPLE_NAME = 'Ananya Sharma';

var key = sessionStorage.getItem(KEY_STORE) || '';
var image = null;
var cfg = null;

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

function banner(text, kind) {
  var node = $('msg');
  if (!text) { node.classList.add('hidden'); return; }
  node.className = 'banner ' + (kind || 'warn');
  node.textContent = text;
  node.classList.remove('hidden');
}

function draw() {
  if (!image || !cfg) return;
  var canvas = $('stage');
  var width = image.naturalWidth || image.width;
  var height = image.naturalHeight || image.height;

  // Natural size here; CSS scales it to the panel. Pointer maths below uses
  // getBoundingClientRect, so the fractions stay correct at any display size.
  // The saved config is resolution independent either way.
  canvas.width = width;
  canvas.height = height;

  var ctx = canvas.getContext('2d');
  window.CertRender.drawCertificate(ctx, image, SAMPLE_NAME, cfg);
}

function syncInputs() {
  $('size').value = String(Math.round(cfg.size * 1000) / 10);
  $('maxWidth').value = String(Math.round(cfg.maxWidth * 100));
  $('font').value = cfg.font;
  $('weight').value = cfg.weight;
  $('align').value = cfg.align;
  $('color').value = cfg.color;
  $('sizeVal').textContent = cfg.size.toFixed(3) + ' of height';
  $('maxVal').textContent = cfg.maxWidth.toFixed(2) + ' of width';
}

function beginDrag(event) {
  var canvas = $('stage');

  function moveTo(evt) {
    var rect = canvas.getBoundingClientRect();
    var point = evt.touches ? evt.touches[0] : evt;
    var x = (point.clientX - rect.left) / rect.width;
    var y = (point.clientY - rect.top) / rect.height;
    cfg.x = Math.min(1, Math.max(0, x));
    cfg.y = Math.min(1, Math.max(0, y));
    draw();
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

function wireInputs() {
  $('stage').addEventListener('pointerdown', beginDrag);

  $('size').addEventListener('input', function () {
    cfg.size = Number(this.value) / 1000;
    $('sizeVal').textContent = cfg.size.toFixed(3) + ' of height';
    draw();
  });
  $('maxWidth').addEventListener('input', function () {
    cfg.maxWidth = Number(this.value) / 100;
    $('maxVal').textContent = cfg.maxWidth.toFixed(2) + ' of width';
    draw();
  });
  $('font').addEventListener('change', function () { cfg.font = this.value; draw(); });
  $('weight').addEventListener('change', function () { cfg.weight = this.value; draw(); });
  $('align').addEventListener('change', function () { cfg.align = this.value; draw(); });
  $('color').addEventListener('input', function () { cfg.color = this.value; draw(); });
}

function save(templateReady) {
  if (!cfg) return Promise.reject(new Error('Nothing loaded yet.'));
  $('saveMsg').textContent = 'Saving...';
  $('saveMsg').className = 'msg';
  return adminFetch('/api/admin/cert-config', {
    method: 'POST',
    body: {
      name: {
        x: cfg.x, y: cfg.y, size: cfg.size, color: cfg.color,
        font: cfg.font, weight: cfg.weight, align: cfg.align, maxWidth: cfg.maxWidth,
      },
      templateReady: templateReady,
    },
  }).then(function (data) {
    cfg = data.cert.name;
    $('saveMsg').textContent = templateReady
      ? 'Saved. Downloads are now enabled for unlocked students.'
      : 'Saved. Downloads remain ' + (data.cert.templateReady ? 'enabled' : 'disabled') + '.';
    $('saveMsg').className = 'msg ok';
    banner('');
    return data;
  }).catch(function (err) {
    $('saveMsg').textContent = err.message;
    $('saveMsg').className = 'msg err';
  });
}

function loadImage(src) {
  return new Promise(function (resolve, reject) {
    var img = new Image();
    img.onload = function () { resolve(img); };
    img.onerror = function () { reject(new Error('Template image failed to load.')); };
    img.src = src + '?v=' + Date.now();
  });
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
      $('panel').classList.remove('hidden');
      cfg = Object.assign({}, data.cert.name);
      if (!data.cert.templateUrl) {
        banner('No template uploaded yet. Go back to the admin console and upload the artwork first.', 'warn');
        $('panel').classList.add('hidden');
        return null;
      }
      if (!data.cert.templateReady) {
        banner('Downloads are currently disabled. Position the name, then choose "Save and enable downloads".', 'warn');
      }
      return loadImage(data.cert.templateUrl).then(function (img) {
        image = img;
        syncInputs();
        wireInputs();
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
$('btnSave').addEventListener('click', function () { save(undefined); });
$('btnDisable').addEventListener('click', function () { save(false); });

boot();
