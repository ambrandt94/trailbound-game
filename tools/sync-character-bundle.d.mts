export function syncCharacterBundle(
  dist: string,
  options?: { destRoot?: string; maxBytes?: number },
): {
  version: string;
  generatorVersion: number;
  dest: string;
  files: number;
};
