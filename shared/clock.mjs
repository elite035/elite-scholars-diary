// Only business-calendar defaults are injectable. Authentication/session clocks stay real.
export function businessNow() {
  const reference = process.env.NODE_ENV === 'test' ? process.env.TEST_REFERENCE_DATE : undefined;
  if (!reference) return new Date();
  const date = new Date(reference);
  if (!Number.isFinite(date.getTime())) throw Error('Invalid test calendar reference.');
  return date;
}
