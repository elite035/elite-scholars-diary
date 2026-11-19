export async function mountDiagnostics(host, { api, esc }) {
  const section = document.createElement('section');
  section.className = 'card';
  host.append(section);
  section.innerHTML =
    '<div class="cardhead"><h2>Operational readiness & setup</h2></div><div class="cardbody" role="status">Checking school services…</div>';
  try {
    const data = await api('/api/school/readiness');
    const item = (name, ok, detail) =>
      `<p><strong>${esc(name)}: ${ok ? 'Ready' : 'Needs attention'}</strong>${detail ? ' · ' + esc(detail) : ''}</p>`;
    section.innerHTML =
      '<div class="cardhead"><h2>Operational readiness & setup</h2></div><div class="cardbody">' +
      item('Database', data.database.available) +
      (data.cloud
        ? item(
            'Backup',
            !data.backup.overdue,
            data.backup.lastCompleted || 'No hosted completion recorded',
          ) +
          item(
            'Scheduler',
            !data.scheduler.overdue,
            data.scheduler.lastCompleted || 'No completion recorded',
          )
        : '<p>Local recovery and scheduling require the configured operator jobs.</p>') +
      (data.cloud
        ? item(
            'Backup storage',
            data.storage.available,
            data.storage.status ? 'HTTP ' + data.storage.status : '',
          )
        : '') +
      item('Push configuration', data.pushConfigured) +
      `<p>Stale campus mappings: ${Number(data.staleCampusMappings) || 0}</p><h3>Data integrity</h3>${Object.entries(
        data.integrity || {},
      )
        .map(([name, count]) => `<p>${esc(name.replace(/([A-Z])/g, ' $1'))}: ${Number(count)}</p>`)
        .join('')}<h3>Teacher setup</h3>${
        data.setup
          .filter((row) => row.problems.length)
          .map(
            (row) =>
              `<p><strong>${esc(row.name)}</strong> · ${row.problems.map(esc).join(' · ')}</p>`,
          )
          .join('') || '<p>All active teachers have the basic setup dependencies.</p>'
      }<div class="actions"><a href="#/hierarchy">Review hierarchy</a><a href="#/timetable">Teaching assignments</a><a href="#/academics?kind=session">Academic sessions</a></div><p class="muted">These checks do not alter accounts or school records. Hosted service issues require an operator to investigate; no plan upgrades are performed automatically.</p></div>`;
  } catch (error) {
    section.querySelector('.cardbody').textContent =
      'Readiness could not be checked: ' + error.message;
  }
}
