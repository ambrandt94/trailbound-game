export function syncCharacterBundle(
  dist: string,
  options?: { destRoot?: string; maxBytes?: number; pinFile?: string },
): {
  version: string;
  generatorVersion: number;
  dest: string;
  files: number;
  pinFile: string;
};
