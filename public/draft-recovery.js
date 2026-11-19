// Memory only. Never persist private homework to a shared browser/device cache.
export function createDraftRecovery() {
  let saved;
  function fields(form) {
    return [...form.querySelectorAll('input,select,textarea')].filter(
      (field) => field.name && !['password', 'currentPassword', 'newPassword'].includes(field.name),
    );
  }
  function key(field, index) {
    return [
      field.closest('[data-assignment]')?.dataset.assignment ||
        field.closest('[data-entry]')?.dataset.entry ||
        '',
      field.name,
      index,
    ].join(':');
  }
  return {
    capture(form, userId, route) {
      if (!form) return;
      saved = {
        userId,
        route,
        values: fields(form).map((field, index) => ({
          key: key(field, index),
          value: field.value,
          checked: field.checked,
        })),
      };
    },
    route(userId) {
      if (saved && saved.userId !== userId) {
        saved = undefined;
        return null;
      }
      return saved?.route || null;
    },
    restore(form, userId, route) {
      if (!form || !saved || saved.userId !== userId || saved.route !== route) return false;
      const values = new Map(saved.values.map((x) => [x.key, x]));
      for (const [index, field] of fields(form).entries()) {
        const value = values.get(key(field, index));
        if (value) {
          field.value = value.value;
          if (field.type === 'checkbox' || field.type === 'radio') field.checked = value.checked;
          field.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      saved = undefined;
      return true;
    },
    clear() {
      saved = undefined;
    },
  };
}
