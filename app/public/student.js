'use strict';

var state = { me: null };

// ---------------------------------------------------------------------------
// Session handling.
//
// Cookies are not reliable here: the site is often shown inside a frame on a
// different site, where browsers treat the session cookie as third-party and
// drop it. The server therefore also returns a signed token, which we keep in
// memory and send as a Bearer header. Memory is the source of truth; storage is
// only used so a reload does not sign the student out.
// ---------------------------------------------------------------------------
var SESSION_KEY = 'gsa-session-token';
var session = { token: null };

function loadToken() {
  try { session.token = window.localStorage.getItem(SESSION_KEY) || null; }
  catch (err) { session.token = null; }
}

function saveToken(token) {
  session.token = token || null;
  try {
    if (token) window.localStorage.setItem(SESSION_KEY, token);
    else window.localStorage.removeItem(SESSION_KEY);
  } catch (err) { /* private mode, framed storage: memory only */ }
}

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
  var headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (session.token) headers.Authorization = 'Bearer ' + session.token;

  return fetch(path, {
    method: opts.method || 'GET',
    headers: headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  }).then(function (res) {
    return res.json().catch(function () { return {}; }).then(function (data) {
      if (res.status === 401) saveToken(null);
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
  verified: 'approved',
  rejected: 'rejected',
};

// When the organiser approves each submission by hand, "submitted" is not the
// end of the story and the student needs to see that.
function statusText(status) {
  if (status === 'submitted') {
    return state.me && state.me.approvalRequired ? 'waiting for approval' : 'submitted';
  }
  return STATUS_LABEL[status] || status;
}

var STATUS_ICON = {
  verified: 'check_circle',
  submitted: 'schedule',
  rejected: 'cancel',
  empty: 'description',
};

function icon(name, size) {
  return typeof gsaIcon === 'function' ? gsaIcon(name, size || 18) : '';
}

function statusPill(status) {
  var cls = 'pill';
  if (status === 'verified' || status === 'submitted') cls += status === 'verified' ? ' done' : ' pending';
  if (status === 'rejected') cls += ' rejected';
  return el('span', {
    class: cls,
    html: icon(STATUS_ICON[status] || 'info', 14) + '<span>' + statusText(status) + '</span>',
  });
}

/**
 * A notice is a sentence with a mark beside it, so the colour is never the only
 * thing telling you whether it is good news.
 */
function setBanner(node, text, kind, iconName) {
  if (!node) return;
  node.className = 'banner' + (kind ? ' ' + kind : '');
  node.innerHTML =
    '<span class="banner-ico">' + icon(iconName || (kind === 'ok' ? 'check_circle' : kind === 'bad' ? 'warning' : 'info'), 20) + '</span>' +
    '<span>' + (text || '') + '</span>';
}

/**
 * The three numbers that answer "how far am I?" without reading the cards.
 */
function renderKpis(student) {
  var host = $('kpis');
  if (!host) return;
  host.innerHTML = '';

  var required = student.tasks.filter(function (t) { return t.required; });
  var approved = required.filter(function (t) { return t.status === 'verified'; }).length;
  var waiting = (student.waitingFor || []).length;
  var left = (student.untouched || []).length;

  function tile(kind, name, value, label) {
    host.appendChild(
      el('div', { class: 'kpi ' + kind }, [
        el('span', { class: 'kpi-ico', html: icon(name, 18) }),
        el('span', null, [
          el('span', { class: 'kpi-value', text: value }),
          el('span', { class: 'kpi-label', text: label }),
        ]),
      ])
    );
  }

  tile('good', 'check_circle', approved + ' of ' + required.length, approved === 1 ? 'task approved' : 'tasks approved');
  tile(waiting ? 'wait' : 'info', 'schedule', String(waiting), waiting === 1 ? 'waiting for approval' : 'waiting for approval');
  tile(left ? 'bad' : 'good', left ? 'lock' : 'verified', String(left), left === 1 ? 'task still to do' : 'tasks still to do');
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
  var waiting = student.waitingFor || [];
  var untouched = student.untouched || [];
  if (!student.missing.length) {
    $('subGreeting').textContent = 'All required tasks are approved. Your certificate is ready.';
  } else if (untouched.length) {
    $('subGreeting').textContent =
      untouched.length + ' task' + (untouched.length > 1 ? 's' : '') +
      ' left before your certificate unlocks.';
  } else {
    $('subGreeting').textContent =
      'Submitted. Waiting for the organiser to approve ' +
      (waiting.length > 1 ? 'them' : 'it') + '.';
  }
  $('footEmail').textContent = student.email;
  $('footName').textContent = student.name;

  if (student.unlocked) {
    setBanner($('gateBanner'), 'Unlocked. Every required task is approved.', 'ok', 'verified');
  } else if (untouched.length) {
    var line = 'Locked. Still required: ' + untouched.join(', ') + '.';
    if (waiting.length) line += ' Waiting for approval: ' + waiting.join(', ') + '.';
    setBanner($('gateBanner'), line, 'warn', 'lock');
  } else {
    setBanner(
      $('gateBanner'),
      'Everything is submitted. The organiser approves each entry by hand — ' +
        'your certificate unlocks as soon as ' +
        (waiting.length > 1 ? 'they are' : 'it is') + ' approved. Keep this page open or check back.',
      'warn',
      'schedule'
    );
  }

  renderKpis(student);

  var list = $('taskList');
  list.innerHTML = '';
  student.tasks.forEach(function (task) {
    var state =
      task.status === 'verified'
        ? ' done'
        : task.status === 'rejected'
        ? ' rejected'
        : task.status === 'submitted'
        ? ' waiting'
        : '';
    var card = el('div', { class: 'task' + state });

    var head = el('div', { class: 'head' }, [
      el('span', { class: 'task-ico', html: icon(STATUS_ICON[task.status] || 'description', 20) }),
      el('span', { class: 'name', text: task.label }),
      statusPill(task.status),
    ]);
    card.appendChild(head);
    if (task.hint) card.appendChild(el('p', { class: 'hint', text: task.hint }));

    // The form comes first, because filling it in is the task. The box below is
    // only for the confirmation it gives you.
    if (task.formUrl) {
      card.appendChild(
        el('p', { style: 'margin:0 0 10px' }, [
          el('a', {
            href: task.formUrl,
            target: '_blank',
            rel: 'noopener noreferrer',
            class: 'form-link',
            html: icon('open_in_new', 16) + '<span>' + (task.formLabel || 'Open the form') + '</span>',
          }),
        ])
      );
      card.appendChild(
        el('p', {
          class: 'tiny',
          style: 'margin:0 0 10px',
          text: 'Then paste the confirmation it shows you into the box below.',
        })
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
      html: icon('upload', 16) + '<span>' + (task.receipt ? 'Update' : 'Submit') + '</span>',
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
            setMsg(
              msg,
              state.me && state.me.approvalRequired
                ? 'Sent. The organiser will approve it, then your certificate unlocks.'
                : 'Saved.',
              'ok'
            );
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
      html: icon('image', 16) + '<span>' + (task.hasProof ? 'Replace screenshot' : 'Add screenshot (optional)') + '</span>',
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

function setCertPill(cls, text) {
  var pill = $('certPill');
  if (!pill) return;
  pill.className = 'pill ' + cls;
  pill.innerHTML = icon(cls === 'done' ? 'verified' : cls === 'pending' ? 'schedule' : 'lock', 14) +
    '<span>' + text + '</span>';
}

function renderCertCard(student) {
  var body = $('certBody');
  body.innerHTML = '';

  if (!student.unlocked) {
    setCertPill('', 'locked');
    body.appendChild(
      el('p', {
        class: 'muted',
        text: 'Finish every required task above. The download form appears here the moment you unlock.',
      })
    );
    return;
  }

  if (!state.me.cert.ready) {
    setCertPill('pending', 'artwork pending');
    var gaps = [];
    if (!state.me.cert.templateReady) gaps.push('the certificate artwork');
    if (!state.me.cert.signatureReady) gaps.push('the signature');
    body.appendChild(
      el('div', {
        class: 'banner warn',
        html:
          '<span class="banner-ico">' + icon('warning', 20) + '</span><span>' +
          'You are unlocked, but ' + gaps.join(' and ') +
          ' still needs to be added by the organiser before certificates can be issued.</span>',
      })
    );
    return;
  }

  setCertPill(student.cert ? 'done' : 'info', student.cert ? 'issued' : 'ready');

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
    html: icon('download', 18) + '<span>Download certificate</span>',
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
    .then(function (data) {
      saveToken(data.token);
      return refresh();
    })
    .then(function (me) {
      if (!me.signedIn) {
        saveToken(null);
        setMsg(msg, 'Registered, but this browser did not keep the session. Try signing in.', 'err');
      } else {
        setMsg(msg, '');
      }
    })
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
    .then(function (data) {
      saveToken(data.token);
      return refresh();
    })
    .then(function (me) {
      if (!me.signedIn) {
        saveToken(null);
        setMsg(msg, 'Sign-in reached the server but this browser dropped the session. Please try again.', 'err');
      } else {
        setMsg(msg, '');
      }
    })
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
    .catch(function () { /* sign out locally regardless */ })
    .then(function () {
      saveToken(null);
      return refresh();
    });
});

// The programme lockup is optional: if the organiser drops the official file in
// (app/public/brand/gsa-logo.png) it appears in the footer, and if it is not
// there the footer simply shows the Google and Gemini marks. A 404 removes the
// slot instead of leaving a broken image.
(function () {
  var slot = $('footGsa');
  if (!slot) return;
  slot.addEventListener('load', function () { slot.classList.remove('hidden'); });
  slot.addEventListener('error', function () {
    if (slot.parentNode) slot.parentNode.removeChild(slot);
  });
})();

loadToken();
refresh().catch(function (err) {
  document.body.insertAdjacentHTML(
    'afterbegin',
    '<div class="wrap"><div class="banner bad">Could not reach the server: ' +
      String(err.message).replace(/[<>&]/g, '') + '</div></div>'
  );
});
