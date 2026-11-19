import { STAFF_ROLES } from './teacher-campus.mjs';
import { integrityAudit } from './integrity-audit.mjs';
export async function readiness(db) {
  const last = async (action) =>
    await db.one(
      'SELECT created_at,details FROM audit WHERE action=? ORDER BY created_at DESC LIMIT 1',
      action,
    );
  const [completed, failed, heartbeat] = await Promise.all([
    last('cloud_backup_completed'),
    last('cloud_backup_failed'),
    last('deadlines_completed'),
  ]);
  const age = (stamp) => (stamp ? Math.max(0, Date.now() - Date.parse(stamp)) : null);
  const cloud = db.dialect === 'postgres';
  let storage = { configured: false, available: false };
  if (cloud && process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY) {
    try {
      const response = await fetch(
        process.env.SUPABASE_URL.replace(/\/$/, '') + '/storage/v1/bucket/elite-scholars-backups',
        {
          signal: AbortSignal.timeout(5000),
          headers: {
            apikey: process.env.SUPABASE_SECRET_KEY,
            Authorization: 'Bearer ' + process.env.SUPABASE_SECRET_KEY,
          },
        },
      );
      storage = { configured: true, available: response.ok, status: response.status };
    } catch {
      storage = { configured: true, available: false, error: 'Storage check timed out or failed.' };
    }
  }
  const config = db.settings(),
    mapping = config.teacherCampusAssignments || {},
    users = await db.all('SELECT id,name,role,active FROM users'),
    campuses = await db.all("SELECT id,active FROM school_nodes WHERE kind='campus'"),
    reviewers = await db.all('SELECT teacher_id,head_id FROM teacher_reviewers'),
    assignments = await db.all(
      'SELECT teacher_id,section_id,subject_id,session_id FROM assignments WHERE active=1',
    ),
    sessions = await db.all(
      "SELECT id,start_date,end_date,active FROM academics WHERE kind='session'",
    ),
    curriculum = await db.all('SELECT section_id,subject_id FROM section_subjects');
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone || 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const setup = users
    .filter((user) => user.role === 'teacher' && user.active)
    .map((user) => {
      const problems = [],
        campus = campuses.find((campus) => campus.id === mapping[user.id] && campus.active),
        reviewer = reviewers.find((row) => row.teacher_id === user.id),
        head = users.find(
          (head) => head.id === reviewer?.head_id && head.active && head.role === 'head_teacher',
        ),
        responsibilities = assignments.filter((row) => row.teacher_id === user.id);
      if (!campus) problems.push('Assign an active campus');
      if (!head) problems.push('Assign an active Head Teacher');
      if (!responsibilities.length) problems.push('Add teaching assignments');
      if (
        !sessions.some(
          (session) => session.active && session.start_date <= today && session.end_date >= today,
        )
      )
        problems.push('Configure a current academic session');
      if (
        responsibilities.some(
          (row) =>
            !curriculum.some(
              (pair) => pair.section_id === row.section_id && pair.subject_id === row.subject_id,
            ),
        )
      )
        problems.push('Review section subject configuration');
      return { id: user.id, name: user.name, problems };
    });
  const staleCampusMappings = Object.entries(mapping).filter(
    ([id, campus]) =>
      !users.some((user) => user.id === id && STAFF_ROLES.includes(user.role) && user.active) ||
      !campuses.some((row) => row.id === campus && row.active),
  ).length;
  return {
    integrity: await integrityAudit(db),
    setup,
    staleCampusMappings,
    checkedAt: new Date().toISOString(),
    database: { available: !!(await db.one('SELECT 1 AS ok')) },
    cloud,
    storage,
    backup: {
      lastCompleted: completed?.created_at || null,
      lastFailure: failed?.created_at || null,
      overdue:
        cloud && (age(completed?.created_at) === null || age(completed.created_at) > 36 * 3600000),
    },
    scheduler: {
      lastCompleted: heartbeat?.created_at || null,
      overdue:
        cloud && (age(heartbeat?.created_at) === null || age(heartbeat.created_at) > 45 * 60000),
    },
    pushConfigured: !!(
      process.env.VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.VAPID_SUBJECT
    ),
  };
}
