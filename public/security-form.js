export async function mountAccountSecurity(host, { api, esc, toast }) {
  const section = document.createElement('section');
  section.className = 'card';
  host.append(section);
  let status;
  try {
    status = await api('/api/school/security');
  } catch (error) {
    section.innerHTML = '<div class="cardbody"><p>' + esc(error.message) + '</p></div>';
    return;
  }
  section.innerHTML = `<div class="cardhead"><h2>Account security</h2></div><div class="cardbody"><p>${status.mfaEnabled ? 'Authenticator protection is enabled.' : 'Add an authenticator to protect your account.'}</p><p class="muted">Recovery codes are shown once. Keep them privately outside this application.</p>${status.encryptionConfigured ? `<form data-security-form><label class="field">Current password<input type="password" name="currentPassword" autocomplete="current-password" maxlength="128" required></label>${status.mfaEnabled ? '<label class="field">Authenticator or recovery code<input name="code" autocomplete="one-time-code" required maxlength="100"></label><button type="submit">Disable authenticator</button>' : '<button type="submit">Set up authenticator</button>'}</form>` : '<p class="alert">An administrator must configure account-security encryption before enabling an authenticator.</p>'}<div data-security-setup></div><p data-security-error role="alert"></p><h3>Confirm your identity</h3><form data-security-reauth><label class="field">Current password<input type="password" name="currentPassword" autocomplete="current-password" required maxlength="128"></label>${status.mfaEnabled ? '<label class="field">Authenticator or recovery code<input name="code" autocomplete="one-time-code" maxlength="100" required></label>' : ''}<button type="submit">Confirm identity for sensitive changes</button></form><h3>Your active sessions</h3><div data-security-sessions>${status.sessions.map((session) => `<p>${session.current ? 'This device · ' : ''}Expires ${esc(new Date(session.expires_at).toLocaleString())} <button type="button" data-revoke-session="${esc(session.id)}">Sign out session</button></p>`).join('')}</div><h3>Install the school diary</h3><p class="muted">Use your browser’s Install app option. On iPhone or iPad, open the site in Safari, choose Share, then Add to Home Screen. An internet connection is required to access school records.</p></div>`;
  const error = section.querySelector('[data-security-error]');
  let busy = false;
  async function act(fn) {
    if (busy) return;
    busy = true;
    error.textContent = '';
    const buttons = [...section.querySelectorAll('button')];
    buttons.forEach((button) => (button.disabled = true));
    try {
      await fn();
    } catch (problem) {
      error.textContent = problem.message;
    } finally {
      busy = false;
      buttons.forEach((button) => (button.disabled = false));
    }
  }
  const reauth = section.querySelector('[data-security-reauth]');
  reauth.addEventListener('submit', (event) => {
    event.preventDefault();
    event.stopPropagation();
    act(async () => {
      await api('/api/school/security/reauth', {
        method: 'POST',
        body: {
          currentPassword: reauth.elements.currentPassword.value,
          code: reauth.elements.code?.value,
        },
      });
      reauth.reset();
      toast('Identity confirmed. Review and retry your sensitive change.');
    });
  });
  const form = section.querySelector('[data-security-form]');
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const password = form.elements.currentPassword.value;
    act(async () => {
      if (status.mfaEnabled) {
        await api('/api/school/security/disable', {
          method: 'POST',
          body: { currentPassword: password, code: form.elements.code.value },
        });
        toast('Authenticator disabled.');
        section.remove();
        await mountAccountSecurity(host, { api, esc, toast });
        return;
      }
      const setup = await api('/api/school/security/setup', {
        method: 'POST',
        body: { currentPassword: password },
      });
      form.elements.currentPassword.value = '';
      section.querySelector('[data-security-setup]').innerHTML =
        `<form data-security-enable><p>In your authenticator, add an account manually using this setup key. It expires in ten minutes.</p><pre class="preserve-lines">${esc(setup.secret)}</pre><label class="field">Current password<input type="password" name="currentPassword" autocomplete="current-password" required maxlength="128"></label><label class="field">Six-digit authenticator code<input name="code" inputmode="numeric" autocomplete="one-time-code" required pattern="[0-9]{6}" maxlength="6"></label><button type="submit">Verify and enable</button></form>`;
      const enable = section.querySelector('[data-security-enable]');
      enable.addEventListener('submit', (event) => {
        event.preventDefault();
        event.stopPropagation();
        act(async () => {
          const result = await api('/api/school/security/enable', {
            method: 'POST',
            body: {
              currentPassword: enable.elements.currentPassword.value,
              code: enable.elements.code.value,
            },
          });
          enable.innerHTML =
            '<h3>Save these recovery codes privately</h3><p>Each code can be used once to sign in. These codes will not be shown again.</p><pre class="preserve-lines">' +
            esc(result.recoveryCodes.join('\n')) +
            '</pre>';
          status.mfaEnabled = true;
          form.remove();
          toast('Authenticator enabled. Save your recovery codes now.');
        });
      });
    });
  });
  for (const button of section.querySelectorAll('[data-revoke-session]'))
    button.addEventListener('click', () => {
      if (!window.confirm('Sign out this session?')) return;
      act(async () => {
        await api('/api/school/security/session', {
          method: 'DELETE',
          body: { id: button.dataset.revokeSession },
        });
        button.closest('p').remove();
        toast('Session signed out.');
      });
    });
}
