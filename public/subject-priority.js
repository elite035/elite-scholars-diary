export function subjectPriority(value = 0) {
  const valid = typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value));
  const priority = valid ? Number(value) : NaN;
  if (!Number.isInteger(priority) || priority < 0 || priority > 1000000)
    throw Object.assign(Error('Subject priority must be a whole number from 0 to 1000000.'), {
      status: 400,
    });
  return priority;
}
