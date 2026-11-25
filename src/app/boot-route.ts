export type BootRoute = 'dojo' | 'town' | 'title';

/** `?mode=dojo` wins, including over `?town=`, so the dojo never enters a town. */
export function bootRoute(search: string): BootRoute {
  const params = new URLSearchParams(search);
  if (params.get('mode') === 'dojo') return 'dojo';
  if (params.get('town')) return 'town';
  return 'title';
}
