'use strict';

var state = { me: null };

function $(id) { return document.getElementById(id); }

function el(tag, props, children) {
  var node = document.createElement(tag);
  if (props) {
    Object.keys(props).forEach(function (key) {
      if (key === 'text') node.textContent = props[key];
      else if (key === 'class') node.className = props[key];
      else if (key === 'html') node.innerHTML = props[key];
      else if (key.indexOf('on') === 0) node.addEventListener(key.slice(2), props[key]);
      else node.setAttribute(key, props[key]);
    });
  }
  (children || []).forEach(function (child) {
    if (child == null) return;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  });
  return node;
}

function api(path, options) {
  var opts = options || {};
  return fetch(path, {
    method: opts.method || 'GET',
    headers: Object.assign(
      { 'Content-Type': 'application/json' },
      opts.headers || {}
    ),
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  }).then(function (res) {
    return res.json().catch(function () { return {}; }).then(function (data) {
      if (!res.ok) throw new Error(data.error || 'Request failed (' + res.status + ')');
      return data;
    });
  });
}

function setMsg(node, text, kind) {
  if (!node) return;
  node.textContent = text || '';
  node.className = 'msg' + (kind ? ' ' + kind : '');
}

var STATUS_LABEL = {
  empty: 'not done',
  submitted: 'submitted',
  verified: 'verified',
  rejected: 'rejected',
};

function statusPill(status) {
  var cls = 'pill';
  if (status === 'verified' || status === 'submitted') cls += status === 'verified' ? ' done' : ' pending';
  if (status === 'rejected') cls += ' rejected';
  return el('span', { class: cls, text: STATUS_LABEL[status] || status });
}

function render() {
  var me = state.me;
  var signedIn = me && me.signedIn;

  $('siteName').textContent = me.site.name;
  $('siteTagline').textContent = me.site.tagline;

  $('signedOut').classList.toggle('hidden', signedIn);
  $('signedIn').classList.toggle('hidden', !signedIn);
  $('btnSignOut').classList.toggle('hidden', !signedIn);

  if (!signedIn) return;

  var student = me.student;
  $('greeting').textContent = 'Hey ' + student.name.split(' ')[0];
  $('subGreeting').textContent = student.missing.length
    ? student.missing.length + ' task' + (student.missing.length > 1 ? 's' : '') +
      ' left before your certificate unlocks.'
    : 'All required tasks are done. Your certificate is ready.';
  $('footEmail').textContent = student.email;
  $('footName').textContent = student.name;

  var banner = $('gateBanner');
  if (student.unlocked) {
    banner.className = 'banner ok';
    banner.textContent = 'Unlocked. Every required task is complete.';
  } else {
    banner.className = 'banner warn';
    banner.textContent = 'Locked. Still required: ' + student.missing.join(', ') + '.';
  }

  var list = $('taskList');
  list.innerHTML = '';
  student.tasks.forEach(function (task) {
    var card = el('div', {
      class: 'task ' + (task.status === 'verified' ? 'done' : task.status === 'rejected' ? 'rejected' : ''),
    });

    var head = el('div', { class: 'head' }, [
      el('span', { class: 'name', text: task.label }),
      statusPill(task.status),
    ]);
    card.appendChild(head);
    if (task.hint) card.appendChild(el('p', { class: 'hint', text: task.hint }));

    if (task.formUrl) {
      card.appendChild(
        el('p', { style: 'margin:0 0 12px' }, [
          el('a', {
            href: task.formUrl,
            target: '_blank',
            rel: 'noopener noreferrer',
            class: 'tiny',
            style: 'color:var(--accent)',
            text: 'Open the form',
          }),
        ])
      );
    }

    if (task.receipt) {
      card.appendChild(
        el('p', { class: 'tiny', text: 'Your submission: ' + task.receipt })
      );
    }

    var input = el('textarea', {
      placeholder: 'Paste your confirmation message or link here',
      maxlength: '1000',
      rows: '2',
    });
    if (task.receipt) input.value = task.receipt;

    var msg = el('div', { class: 'msg' });

    var submit = el('button', {
      class: 'primary small',
      type: 'button',
      text: task.receipt ? 'Update' : 'Submit',
      onclick: function () {
        var value = input.value.trim();
        if (value.length < 3) {
          setMsg(msg, 'Paste your confirmation first.', 'err');
          return;
        }
        submit.disabled = true;
        setMsg(msg, 'Saving...');
        api('/api/tasks/' + encodeURIComponent(task.key) + '/receipt', {
          method: 'POST',
          body: { receipt: value },
        })
          .then(function () {
            setMsg(msg, 'Saved.', 'ok');
            return refresh();
          })
          .catch(function (err) {
            setMsg(msg, err.message, 'err');
            submit.disabled = false;
          });
      },
    });

    var file = el('input', { type: 'file', accept: 'image/png,image/jpeg', class: 'hidden' });
    var upload = el('button', {
      class: 'ghost small',
      type: 'button',
      text: task.hasProof ? 'Replace screenshot' : 'Add screenshot (optional)',
      onclick: function () { file.click(); },
    });
    file.addEventListener('change', function () {
      var chosen = file.files && file.files[0];
      if (!chosen) return;
      if (chosen.size > 4 * 1024 * 1024) {
        setMsg(msg, 'That image is over 4 MB. Please use a smaller screenshot.', 'err');
        return;
      }
      upload.disabled = true;
      setMsg(msg, 'Uploading...');
      fetch('/api/tasks/' + encodeURIComponent(task.key) + '/proof', {
        method: 'POST',
        headers: { 'Content-Type': chosen.type || 'application/octet-stream' },
        body: chosen,
        credentials: 'same-origin',
      })
        .then(function (res) {
          return res.json().then(function (data) {
            if (!res.ok) throw new Error(data.error || 'Upload failed');
            return data;
          });
        })
        .then(function () {
          setMsg(msg, 'Screenshot attached.', 'ok');
          return refresh();
        })
        .catch(function (err) {
          setMsg(msg, err.message, 'err');
          upload.disabled = false;
        });
    });

    card.appendChild(input);
    card.appendChild(el('div', { class: 'row', style: 'margin-top:10px' }, [submit, upload, file]));
    card.appendChild(msg);
    list.appendChild(card);
  });

  renderCertCard(student);
}

function renderCertCard(student) {
  var body = $('certBody');
  body.innerHTML = '';

  if (!student.unlocked) {
    body.appendChild(
      el('p', {
        class: 'muted',
        text: 'Finish every required task above. The download form appears here the moment you unlock.',
      })
    );
    return;
  }

  if (!state.me.cert.templateReady) {
    body.appendChild(
      el('div', {
        class: 'banner warn',
        text: 'You are unlocked, but the certificate artwork has not been loaded yet. The organiser needs to add the template before downloads can be issued.',
      })
    );
    return;
  }

  if (student.cert) {
    body.appendChild(
      el('p', {
        class: 'muted',
        text: 'Issued to ' + student.cert.name + ' on ' +
          new Date(student.cert.issuedAt).toLocaleString() + '. Serial ' + student.cert.serial + '.',
      })
    );
  }

  body.appendChild(
    el('p', {
      class: 'muted',
      text: 'Type your full name exactly as you registered it, then download.',
    })
  );

  var input = el('input', {
    type: 'text',
    placeholder: 'Your full name',
    maxlength: '80',
    autocomplete: 'name',
  });
  var msg = el('div', { class: 'msg' });
  var go = el('button', {
    class: 'primary',
    type: 'button',
    text: 'Download certificate',
    onclick: function () {
      var typed = input.value.trim();
      if (!typed) { setMsg(msg, 'Type your name first.', 'err'); return; }
      go.disabled = true;
      setMsg(msg, 'Preparing...');
      api('/api/certificate/issue', { method: 'POST', body: { name: typed } })
        .then(function (data) {
          window.location.href = '/certificate?name=' + encodeURIComponent(typed);
          return data;
        })
        .catch(function (err) {
          setMsg(msg, err.message, 'err');
          go.disabled = false;
        });
    },
  });

  body.appendChild(input);
  body.appendChild(el('div', { class: 'row', style: 'margin-top:10px' }, [go]));
  body.appendChild(msg);
}

function refresh() {
  return api('/api/me').then(function (me) {
    state.me = me;
    render();
    return me;
  });
}

// ---- forms ----------------------------------------------------------------
$('formRegister').addEventListener('submit', function (event) {
  event.preventDefault();
  var msg = $('regMsg');
  var btn = $('btnRegister');
  btn.disabled = true;
  setMsg(msg, 'Creating your registration...');
  api('/api/register', {
    method: 'POST',
    body: {
      name: $('regName').value.trim(),
      email: $('regEmail').value.trim(),
      campus: $('regCampus').value.trim(),
    },
  })
    .then(function () { return refresh(); })
    .catch(function (err) { setMsg(msg, err.message, 'err'); })
    .then(function () { btn.disabled = false; });
});

$('formLogin').addEventListener('submit', function (event) {
  event.preventDefault();
  var msg = $('loginMsg');
  var btn = $('btnLogin');
  btn.disabled = true;
  setMsg(msg, 'Signing in...');
  api('/api/login', {
    method: 'POST',
    body: { email: $('loginEmail').value.trim() },
  })
    .then(function () { return refresh(); })
    .catch(function (err) { setMsg(msg, err.message, 'err'); })
    .then(function () { btn.disabled = false; });
});

$('btnShowLogin').addEventListener('click', function () {
  $('formRegister').classList.add('hidden');
  $('formLogin').classList.remove('hidden');
});
$('btnShowRegister').addEventListener('click', function () {
  $('formLogin').classList.add('hidden');
  $('formRegister').classList.remove('hidden');
});

$('btnSignOut').addEventListener('click', function () {
  api('/api/logout', { method: 'POST' })
    .then(function () { return refresh(); })
    .catch(function () { return refresh(); });
});

refresh().catch(function (err) {
  document.body.insertAdjacentHTML(
    'afterbegin',
    '<div class="wrap"><div class="banner bad">Could not reach the server: ' +
      String(err.message).replace(/[<>&]/g, '') + '</div></div>'
  );
});
