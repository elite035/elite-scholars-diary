export const crudModules = ['structure', 'people', 'assignments', 'quotes'];
export const crudActions = ['view', 'create', 'edit', 'delete'];
export const capabilityNames = [
  ...crudModules.flatMap((m) => crudActions.map((a) => m + '.' + a)),
  'structure.manage',
  'people.manage',
  'hierarchy.manage',
  'assignments.manage',
  'parents.manage',
  'permissions.manage',
  'diary.view',
  'diary.create',
  'diary.edit',
  'diary.delete',
  'diary.submit',
  'diary.review',
  'diary.approve',
  'diary.return',
  'diary.amend',
  'diary.export',
  'quotes.manage',
  'reports.view',
  'audit.view',
  'notifications.manage',
  'settings.manage',
  'template.manage',
  'communication.use',
  'communication.oversight',
  'records.force_delete',
];
const staffRead = ['diary.view', 'diary.export', 'reports.view', 'communication.use'];
export const roleDefaults = {
  super_admin: capabilityNames,
  school_admin: capabilityNames.filter((x) => x !== 'communication.oversight'),
  coordinator: staffRead,
  head_teacher: [...staffRead, 'diary.review', 'diary.approve', 'diary.return'],
  teacher: [...staffRead, 'diary.create', 'diary.edit', 'diary.delete', 'diary.submit'],
  parent: ['diary.view', 'diary.export'],
};
export function permissionService(db) {
  return async function capabilities(u) {
    if (u.role === 'super_admin') return [...capabilityNames];
    const policy = await db.one('SELECT grants FROM role_capabilities WHERE role=?', u.role),
      individual = await db.one(
        'SELECT allows,denies FROM user_capabilities WHERE user_id=?',
        u.id,
      );
    const base = policy ? JSON.parse(policy.grants) : roleDefaults[u.role] || [],
      grants = new Set(base);
    for (const m of crudModules)
      if (
        base.includes(m + '.manage') &&
        !base.some((x) => crudActions.some((a) => x === m + '.' + a))
      )
        for (const a of crudActions) grants.add(m + '.' + a);
    if (individual) {
      for (const x of JSON.parse(individual.allows)) {
        grants.add(x);
        if (crudModules.some((m) => x === m + '.manage'))
          for (const a of crudActions) grants.add(x.replace('manage', a));
      }
    }
    for (const m of crudModules)
      if (crudActions.some((a) => grants.has(m + '.' + a))) grants.add(m + '.manage');
    if (individual) {
      const denied = JSON.parse(individual.denies);
      for (const x of denied) {
        grants.delete(x);
        if (crudModules.some((m) => x === m + '.manage'))
          for (const a of crudActions) grants.delete(x.replace('manage', a));
      }
    }
    return [...grants];
  };
}

export const roleRestrictions = Object.fromEntries(
  Object.keys(roleDefaults).map((role) => [
    role,
    Object.fromEntries(
      capabilityNames.flatMap((cap) => {
        const admin =
          [
            'people.manage',
            'hierarchy.manage',
            'permissions.manage',
            'audit.view',
            'settings.manage',
            'template.manage',
            'records.force_delete',
          ].includes(cap) || cap.startsWith('people.');
        const staff =
          ['structure.manage', 'assignments.manage', 'parents.manage', 'quotes.manage'].includes(
            cap,
          ) || ['structure.', 'assignments.', 'quotes.'].some((prefix) => cap.startsWith(prefix));
        const reason =
          admin && !['super_admin', 'school_admin'].includes(role)
            ? 'Requires an administrator account.'
            : staff &&
                !['super_admin', 'school_admin', 'coordinator', 'head_teacher'].includes(role)
              ? 'Requires an administrator, Coordinator or Head Teacher.'
              : cap === 'communication.oversight' && role !== 'super_admin'
                ? 'Reserved for Super Admin.'
                : null;
        return reason ? [[cap, reason]] : [];
      }),
    ),
  ]),
);
