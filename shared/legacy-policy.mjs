const mutations = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Retained records keep their pre-capability role/explicit grants until an
// administrator saves a current policy. Explicit current policies always win.
export function retainedGrants(user) {
  const permissions = JSON.parse(user.permissions || '[]'),
    grants = new Set();
  const mapping = {
    manage_quotes: 'quotes',
    manage_quotes_all: 'quotes',
    manage_academics: 'structure',
    manage_users: 'people',
  };
  for (const [old, module] of Object.entries(mapping))
    if (permissions.includes(old))
      for (const action of ['view', 'create', 'edit', 'delete', 'manage'])
        grants.add(module + '.' + action);
  if (permissions.includes('manage_academics'))
    for (const action of ['view', 'create', 'edit', 'delete', 'manage'])
      grants.add('assignments.' + action);
  if (user.role === 'coordinator' || permissions.includes('review_all'))
    for (const action of ['review', 'approve', 'return']) grants.add('diary.' + action);
  return grants;
}
export function legacyPolicy(path, method, body = {}, query = {}) {
  const write = mutations.has(method),
    caps = [],
    old = [];
  const need = (...names) => caps.push(...names),
    bridge = (...names) => old.push(...names);
  if (path === '/api/export' || /^\/api\/attachments\//.test(path)) {
    need('diary.view', 'diary.export');
    bridge('export');
  } else if (/^\/api\/(?:diaries|class-diary)(?:\/|$)/.test(path)) {
    need('diary.view');
    if (path.endsWith('/review'))
      need(
        body.action === 'approved'
          ? 'diary.approve'
          : body.action === 'returned'
            ? 'diary.return'
            : 'diary.review',
      );
    else if (path.endsWith('/amend')) {
      need('diary.amend');
      bridge('amend');
    } else if (
      path.endsWith('/export') ||
      path.endsWith('/print') ||
      (path.endsWith('/preview') && query.format)
    ) {
      need('diary.export');
      bridge('export');
    } else if (write) {
      if (path === '/api/class-diary/save') {
        if (body.entries?.some((entry) => !entry.id)) need('diary.create');
        if (body.entries?.some((entry) => entry.id)) need('diary.edit');
      } else need(path === '/api/diaries' ? 'diary.create' : 'diary.edit');
      if (body.submit === true) need('diary.submit');
    }
  } else if (path === '/api/reports') {
    need('reports.view');
    if (query.format) {
      need('diary.export');
      bridge('export');
    }
  } else if (path === '/api/audit') {
    need('audit.view');
    bridge('read_audit');
  } else if (path === '/api/assignment-session' || path.startsWith('/api/exceptions')) {
    if (write) {
      need('structure.manage', 'structure.edit');
      bridge('manage_academics');
    }
  } else if (write) {
    const module = path.startsWith('/api/users')
      ? 'people'
      : path.startsWith('/api/academics') || path.startsWith('/api/class-subjects')
        ? 'structure'
        : path.startsWith('/api/assignments')
          ? 'assignments'
          : path.startsWith('/api/quotes') || path.startsWith('/api/quote-schedules')
            ? 'quotes'
            : null;
    if (module) {
      need(
        module + '.manage',
        module + '.' + { POST: 'create', PUT: 'edit', PATCH: 'edit', DELETE: 'delete' }[method],
      );
      bridge(
        {
          people: 'manage_users',
          structure: 'manage_academics',
          assignments: 'manage_academics',
          quotes: 'manage_quotes',
        }[module],
      );
    }
  }
  return { caps: [...new Set(caps)], bridge: [...new Set(old)] };
}
