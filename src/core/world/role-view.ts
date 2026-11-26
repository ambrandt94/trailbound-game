/**
 * Debug role-colour overlay. Player-facing labels and signs are always on.
 * The colour wash is a URL flag (`?roles=1`) or the World Gen checkbox.
 * It is not an input binding.
 */
let forced: boolean | null = null;

export function roleDebugEnabled(): boolean {
  if (forced !== null) return forced;
  const host = globalThis as {
    __tbRoles?: boolean;
    location?: { search?: string };
    URLSearchParams?: new (query: string) => { get(name: string): string | null };
  };
  if (host.__tbRoles) return true;
  if (!host.URLSearchParams || !host.location?.search) return false;
  return new host.URLSearchParams(host.location.search).get('roles') === '1';
}

export function setRoleDebug(on: boolean): void {
  forced = on;
  (globalThis as { __tbRoles?: boolean }).__tbRoles = on;
}
