'use strict';

var KEY_STORE = 'gsa-admin-key';
var key = '';

function $(id) { return document.getElementById(id); }

function el(tag, props, children) {
  var node = document.createElement(tag);
  if (props) {
    Object.keys(props).forEach(function (name) {
      if (name === 'text') node.textContent = props[name];
      else if (name === 'class') node.className = props[name];
      else if (name.indexOf('on') === 0) node.addEventListener(name.slice(2), props[name]);
      else node.setAttribute(name, props[name]);
    });
  }
  (children || []).forEach(function (child) {
    if (child == null) return;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  });
  return node;
}

function setMsg(node, text, kind) {
  node.textContent = text || '';
  node.className = 'msg' + (kind ? ' ' + kind : '');
}

function adminFetch(path, options) {
  var opts = options || {};
  return fetch(path, {
    method: opts.method || 'GET',
    headers: Object.assign({ 'x-admin-key': key }, opts.raw ? {} : { 'Content-Type': 'application/json' }),
    body: opts.body,
    credentials: 'same-origin',
  }).then(function (res) {
    if (opts.raw && res.ok) return res;
    return res.json().catch(function () { return {}; }).then(function (data) {
      if (!res.ok) throw new Error(data.error || 'Request failed (' + res.status + ')');
      return data;
    });
  });
}

function setKey(value) {
  key = value;
  $('keyPanel').classList.toggle('hidden', !!value);
  $('panel').classList.toggle('hidden', !value);
  $('btnLock').classList.toggle('hidden', !value);
}

function renderTemplate(cert) {
  var banner = $('tplBanner');
  var templateName = cert.templateUrl ? cert.templateUrl.split('/').pop() : null;
  var sigName = cert.signatureUrl ? cert.signatureUrl.split('/').pop() : null;

  if (!templateName) {
    banner.className = 'banner warn';
    banner.textContent =
      'No certificate artwork uploaded yet. Upload the official image to continue.';
  } else if (!sigName) {
    banner.className = 'banner warn';
    banner.textContent =
      'Artwork uploaded, but your signature image is missing. Downloads stay locked until it is added — an unsigned certificate is not a certificate.';
  } else if (!cert.templateReady) {
    banner.className = 'banner warn';
    banner.textContent =
      'Artwork and signature are in place but downloads are disabled. Open calibration to position the name and date, then enable.';
  } else {
    banner.className = 'banner ok';
    banner.textContent = 'Live. Unlocked students can download their certificate.';
  }

  $('tplState').textContent = templateName
    ? 'Artwork: ' + templateName + (cert.templateReady ? ' (live)' : ' (not enabled)')
    : 'No artwork uploaded.';
  $('sigState').textContent = sigName
    ? 'Signature: ' + sigName
    : 'Signature: not uploaded.';
}

function taskCell(student, task) {
  var cls = 'pill';
  if (task.status === 'verified') cls += ' done';
  else if (task.status === 'submitted') cls += ' pending';
  else if (task.status === 'rejected') cls += ' rejected';

  var bits = [el('span', { class: cls, text: task.status })];
  if (task.receipt) {
    bits.push(el('div', { class: 'tiny', style: 'margin-top:4px;max-width:220px;word-break:break-word', text: task.receipt }));
  }
  if (task.hasProof) {
    bits.push(
      el('a', {
        href: '/api/admin/students/' + student.id + '/proof/' + task.key,
        class: 'tiny',
        style: 'display:inline-block;margin-top:4px',
        target: '_blank',
        rel: 'noopener',
        text: 'screenshot',
      })
    );
  }

  var actions = el('div', { class: 'row', style: 'margin-top:6px;gap:6px' }, [
    el('button', {
      class: 'ghost small', type: 'button', text: 'Verify',
      onclick: function () { setTask(student.id, task.key, 'verified'); },
    }),
    el('button', {
      class: 'ghost small', type: 'button', text: 'Reject',
      onclick: function () { setTask(student.id, task.key, 'rejected'); },
    }),
  ]);

  return el('td', null, bits.concat([actions]));
}

function setTask(studentId, taskKey, status) {
  adminFetch('/api/admin/students/' + studentId + '/task', {
    method: 'POST',
    body: JSON.stringify({ key: taskKey, status: status }),
  })
    .then(load)
    .catch(function (err) { alert(err.message); });
}

function render(data) {
  renderTemplate(data.cert);

  var stats = $('stats');
  stats.innerHTML = '';
  stats.appendChild(el('span', { class: 'pill', text: data.stats.total + ' registered' }));
  stats.appendChild(el('span', { class: 'pill done', text: data.stats.unlocked + ' unlocked' }));
  stats.appendChild(el('span', { class: 'pill done', text: data.stats.issued + ' issued' }));

  var head = $('table').querySelector('thead');
  var body = $('table').querySelector('tbody');
  head.innerHTML = '';
  body.innerHTML = '';

  var columns = ['Student', 'Tasks', 'Status', 'Certificate'];

  head.appendChild(
    el('tr', null, columns.map(function (name) { return el('th', { text: name }); }))
  );

  if (!data.students.length) {
    $('emptyNote').classList.remove('hidden');
    $('emptyNote').textContent = 'No students yet. Share the site link and they will appear here.';
  } else {
    $('emptyNote').classList.add('hidden');
  }

  data.students.forEach(function (student) {
    var who = el('td', null, [
      el('div', { text: student.name }),
      el('div', { class: 'tiny', text: student.email }),
      student.campus ? el('div', { class: 'tiny', text: student.campus }) : null,
    ]);

    var tasksCell = el('td', null, student.tasks.map(function (task) {
      var wrap = el('div', { style: 'margin-bottom:8px' }, [
        el('div', { class: 'tiny', text: task.label }),
      ]);
      var inner = taskCell(student, task);
      while (inner.firstChild) wrap.appendChild(inner.firstChild);
      return wrap;
    }));

    var statusCell = el('td', null, [
      el('span', {
        class: 'pill ' + (student.unlocked ? 'done' : ''),
        text: student.unlocked ? 'unlocked' : 'locked',
      }),
      student.missing.length
        ? el('div', { class: 'tiny', style: 'margin-top:4px', text: 'missing: ' + student.missing.join(', ') })
        : null,
    ]);

    var certCell = student.cert
      ? el('td', null, [
          el('div', { class: 'mono tiny', text: student.cert.serial }),
          el('div', { class: 'tiny', text: new Date(student.cert.issuedAt).toLocaleString() }),
        ])
      : el('td', null, [el('span', { class: 'tiny', text: 'not issued' })]);

    body.appendChild(el('tr', null, [who, tasksCell, statusCell, certCell]));
  });
}

function load() {
  return adminFetch('/api/admin/students')
    .then(render)
    .catch(function (err) {
      if (/not_admin/i.test(err.message) || /403/.test(err.message)) {
        setKey('');
        sessionStorage.removeItem(KEY_STORE);
        setMsg($('keyMsg'), 'That key was not accepted.', 'err');
      } else {
        alert(err.message);
      }
    });
}

$('btnUnlock').addEventListener('click', function () {
  var candidate = $('adminKey').value.trim();
  if (!candidate) { setMsg($('keyMsg'), 'Paste the admin key first.', 'err'); return; }
  key = candidate;
  adminFetch('/api/admin/students')
    .then(function (data) {
      sessionStorage.setItem(KEY_STORE, candidate);
      setKey(candidate);
      render(data);
      setMsg($('keyMsg'), '');
    })
    .catch(function (err) { setMsg($('keyMsg'), err.message, 'err'); });
});

$('adminKey').addEventListener('keydown', function (event) {
  if (event.key === 'Enter') $('btnUnlock').click();
});

$('btnLock').addEventListener('click', function () {
  sessionStorage.removeItem(KEY_STORE);
  setKey('');
});

$('btnRefresh').addEventListener('click', load);

$('btnCalibrate').addEventListener('click', function () {
  window.location.href = '/calibrate';
});

$('btnUploadTpl').addEventListener('click', function () {
  $('tplFile').click();
});

$('tplFile').addEventListener('change', function () {
  var file = $('tplFile').files && $('tplFile').files[0];
  if (!file) return;
  if (file.size > 12 * 1024 * 1024) {
    setMsg($('tplMsg'), 'Template must be under 12 MB.', 'err');
    return;
  }
  setMsg($('tplMsg'), 'Uploading...');
  adminFetch('/api/admin/template', { method: 'POST', body: file, raw: true })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      setMsg($('tplMsg'), 'Uploaded. Now open calibration to place the name and date.', 'ok');
      renderTemplate(data.cert);
    })
    .catch(function (err) { setMsg($('tplMsg'), err.message, 'err'); });
});

$('btnUploadSig').addEventListener('click', function () {
  $('sigFile').click();
});

$('sigFile').addEventListener('change', function () {
  var file = $('sigFile').files && $('sigFile').files[0];
  if (!file) return;
  if (file.size > 12 * 1024 * 1024) {
    setMsg($('tplMsg'), 'Signature must be under 12 MB.', 'err');
    return;
  }
  setMsg($('tplMsg'), 'Uploading signature...');
  adminFetch('/api/admin/signature', { method: 'POST', body: file, raw: true })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      setMsg($('tplMsg'), 'Signature uploaded. Open calibration to check its position.', 'ok');
      renderTemplate(data.cert);
    })
    .catch(function (err) { setMsg($('tplMsg'), err.message, 'err'); });
});

$('btnCsv').addEventListener('click', function () {
  adminFetch('/api/admin/export.csv', { raw: true })
    .then(function (res) { return res.blob(); })
    .then(function (blob) {
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = 'certificate-station.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    })
    .catch(function (err) { alert(err.message); });
});

var saved = sessionStorage.getItem(KEY_STORE);
if (saved) {
  key = saved;
  load().then(function () { setKey(saved); }).catch(function () { setKey(''); });
} else {
  setKey('');
}
