// Deliberately exclude internal teacher mappings, policies and future secrets.
const keys = [
  'name',
  'address',
  'contact',
  'logo',
  'session',
  'timezone',
  'submissionTime',
  'reviewTime',
  'requiredFields',
  'templateVersion',
  'diaryLayout',
  'uploadMaxBytes',
];
export function clientSettings(settings, { administrator = false } = {}) {
  const allowed = administrator
    ? [...keys, 'retentionDays', 'allowSelfApproval', 'assignmentSessionId']
    : keys;
  return Object.fromEntries(
    allowed.filter((key) => Object.hasOwn(settings, key)).map((key) => [key, settings[key]]),
  );
}
