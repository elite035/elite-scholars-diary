// First-run screen: shown only when the database is ready but no Super Admin exists,
// or when the deployment is missing required configuration. No command line needed.
const esc = (x) =>
  String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const brand = `<div class="brand"><img class="brand-logo" src="/assets/official-school-logo.jpeg" alt="Elite Scholars school logo"><div><strong>Elite Scholars School</strong><small>Daily Diary Management</small></div></div>`;

function shell(inner) {
  return `<div class="login"><section class="login-brand">${brand}<div><div class="eyebrow">First-time setup</div><h1>Welcome.<br><em>Let’s open your school diary.</em></h1><p>Create the first Super Admin account. After this, add teachers, heads and parents from User Management.</p></div><footer><div class="eyebrow">Learn · Grow · Succeed</div></footer></section><section class="login-form">${inner}</section></div>`;
}

export async function showSetup(root) {
  let health = null;
  try {
    const response = await fetch('/api/health', { credentials: 'same-origin' });
    health = await response.json();
  } catch {
    return false;
  }
  if (!health || typeof health !== 'object') return false;

  if (health.ok === false) {
    root.innerHTML = shell(
      `<form id="health-form"><div class="eyebrow">Almost there</div><h2>The server needs one more step.</h2><div class="alert error" role="alert">${esc(health.hint || 'The service is not configured yet.')}</div><p class="muted">Open the Vercel project → Settings → Environment Variables, add the missing value, then redeploy. The README lists every value.</p><button class="primary" type="button" id="retry-health">Check again</button></form>`,
    );
    root.querySelector('#retry-health').addEventListener('click', () => location.reload());
    return true;
  }
  if (health.configured) return false;

  root.innerHTML = shell(
    `<form id="setup-form"><div class="eyebrow">Step 1 of 1</div><h2>Create the Super Admin</h2><p class="muted">This screen disappears once the first account exists.</p><div class="alert error" id="setup-error" role="alert"></div>` +
      (health.setupEnabled
        ? ''
        : `<div class="alert error" role="alert">To enable first-time setup, add SETUP_TOKEN (at least 16 random characters) in Replit Secrets, then restart the app.</div>`) +
      `<label class="field">Setup key (your SETUP_TOKEN)<input name="token" type="password" required autocomplete="off"></label><label class="field">Full name<input name="name" type="text" required minlength="2" maxlength="120" autocomplete="name"></label><label class="field">Email address<input name="email" type="email" required autocomplete="username"></label><label class="field">Password (6+ characters)<input name="password" type="password" required minlength="6" maxlength="128" autocomplete="new-password"></label><button class="primary" type="submit" ${health.setupEnabled ? '' : 'disabled'}>Create account</button></form>`,
  );
  const form = root.querySelector('#setup-form');
  const error = root.querySelector('#setup-error');
  let busy = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    error.textContent = '';
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(form));
      const response = await fetch('/api/setup', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(result.error || 'Setup could not be completed.');
      location.hash = '#/login';
      location.reload();
    } catch (e) {
      error.textContent = e.message;
      button.disabled = false;
      busy = false;
    }
  });
  return true;
}
