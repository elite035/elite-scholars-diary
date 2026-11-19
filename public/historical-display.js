// Render a readable historical snapshot without restoring retired fields to the UI.
// This transforms only the displayed copy; audit events and database rows stay immutable.
export function historicalDisplay(value) {
  if (typeof value === 'string' && /^[\[{]/.test(value.trim())) {
    try {
      return historicalDisplay(JSON.parse(value));
    } catch {
      return value;
    }
  }
  if (Array.isArray(value)) return value.map(historicalDisplay);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !['hygiene', 'hygiene_summary'].includes(key))
        .map(([key, child]) => [key, historicalDisplay(child)]),
    );
  return value;
}
