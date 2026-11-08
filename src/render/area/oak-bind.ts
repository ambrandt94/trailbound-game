/**
 * Wood and foliage pools, keyed only by glTF material name.
 * Both primitives live on the node OakRoot, so a mesh-name match paints
 * the foliage atlas onto the trunk.
 */
export interface OakMaps<T> {
  bark: T;
  foliage: T;
  ironbark: T;
}

export interface OakMaterialLike<T> {
  name: string;
  map: T | null;
}

export function assignOakMaterial<T>(
  material: OakMaterialLike<T>,
  maps: OakMaps<T>,
  ironbark: boolean,
): 'bark' | 'foliage' | null {
  if (material.name === 'bark') {
    material.map = ironbark ? maps.ironbark : maps.bark;
    return 'bark';
  }
  if (material.name === 'foliage') {
    material.map = maps.foliage;
    return 'foliage';
  }
  return null;
}

export function bindOakPrimitive<T>(
  mesh: { name: string; material: OakMaterialLike<T> | OakMaterialLike<T>[] },
  maps: OakMaps<T>,
  ironbark: boolean,
): void {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of materials) assignOakMaterial(material, maps, ironbark);
}
