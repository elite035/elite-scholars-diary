// Loads an admin workspace module the first time its page is opened, keeping the first page load small.
// Until then the module has produced no markup, so no action can belong to it and isMine() is false.
export function lazyWorkspace(load, deps) {
  let started, workspace;
  const ensure = () => (started ||= load().then((create) => (workspace = create(deps))));
  return {
    ensure,
    isMine: (action) => !!workspace && workspace.isMine(action),
    page: async (...args) => (await ensure()).page(...args),
    click: async (...args) => (await ensure()).click(...args),
    // Synchronous on purpose: callers `await ensure()` first.
    tabs: (...args) => workspace.tabs(...args),
  };
}
