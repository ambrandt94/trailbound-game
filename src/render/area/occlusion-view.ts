/**
 * Screen-door fade for nature props and building shells that sit between the
 * camera and the player. Instanced trees carry a per-instance visibility.
 * Welded building materials test world position against a few active bounds.
 */

import {
  Box3,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  Matrix4,
  Vector3,
  type BufferGeometry,
  type Camera,
  type InstancedMesh,
  type Material,
  type Mesh,
  type Object3D,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from 'three';
import {
  OCCLUSION,
  OccluderGrid,
  aabbFromMatrix,
  advanceFades,
  expandAabb,
  isFadeRole,
  isProtectedNode,
  linkTreeParts,
  visibilityFor,
  type Aabb,
  type OccCandidate,
  type OccRole,
  type Vec3,
} from './occlusion-select';

const BOXES = OCCLUSION.maxBuildingFades;
const HOLE_PX = 28;

interface FadeUniform {
  value: number;
}

interface ModeData {
  tbOccPatched?: boolean;
  tbOccMode?: 'instance' | 'volume' | 'both';
}

const pxU: FadeUniform = { value: 0 };
const pyU: FadeUniform = { value: 0 };
const holeU: FadeUniform = { value: 0 };
const countU: FadeUniform = { value: 0 };
const minU = Array.from({ length: BOXES }, () => ({ value: new Vector3() }));
const maxU = Array.from({ length: BOXES }, () => ({ value: new Vector3() }));
const visU: FadeUniform[] = Array.from({ length: BOXES }, () => ({ value: 1 }));

const boxScratch = new Box3();
const meshScratch = new Box3();
const instanceMatrix = new Matrix4();
const worldMatrix = new Matrix4();
const projected = new Vector3();

interface Batch {
  attr: InstancedBufferAttribute;
  ids: number[];
  roles: OccRole[];
}

interface BuildingFade {
  id: number;
  bounds: Aabb;
}

let boundRoot: Object3D | null = null;
let grid = new OccluderGrid();
let catalog: OccCandidate[] = [];
let fades = new Float32Array(0);
let batches: Batch[] = [];
let buildings: BuildingFade[] = [];

function modeOf(material: Material): ModeData {
  return material.userData as ModeData;
}

function bindUniforms(shader: WebGLProgramParametersWithUniforms, volume: boolean): void {
  shader.uniforms.uTbPx = pxU;
  shader.uniforms.uTbPy = pyU;
  shader.uniforms.uTbHole = holeU;
  if (!volume) return;
  shader.uniforms.uTbOccN = countU;
  for (let i = 0; i < BOXES; i++) {
    const min = minU[i];
    const max = maxU[i];
    const vis = visU[i];
    if (!min || !max || !vis) continue;
    shader.uniforms[`uTbMin${i}`] = min;
    shader.uniforms[`uTbMax${i}`] = max;
    shader.uniforms[`uTbVis${i}`] = vis;
  }
}

function volumeDecls(): string {
  const lines = ['uniform float uTbOccN;'];
  for (let i = 0; i < BOXES; i++) {
    lines.push(`uniform vec3 uTbMin${i};`, `uniform vec3 uTbMax${i};`, `uniform float uTbVis${i};`);
  }
  return lines.join('\n');
}

function volumeTests(): string {
  const lines: string[] = [];
  for (let i = 0; i < BOXES; i++) {
    lines.push(
      `if(uTbOccN>${i}.5 && tbOccInside(vTbOccW,uTbMin${i},uTbMax${i})) tbOccApply(uTbVis${i});`,
    );
  }
  return lines.join('\n');
}

function fragmentLib(volume: boolean): string {
  return [
    'uniform float uTbPx;',
    'uniform float uTbPy;',
    'uniform float uTbHole;',
    volume ? volumeDecls() : '',
    'varying float vTbOcc;',
    volume ? 'varying vec3 vTbOccW;' : '',
    'float tbOccBayer(vec2 frag){',
    'vec2 f=floor(frag);',
    'float x=mod(f.x,2.0);float y=mod(f.y,2.0);',
    'float m2=y<1.0?(x<1.0?0.0:2.0):(x<1.0?3.0:1.0);',
    'vec2 h=floor(f*0.5);',
    'float x2=mod(h.x,2.0);float y2=mod(h.y,2.0);',
    'float m4=y2<1.0?(x2<1.0?0.0:2.0):(x2<1.0?3.0:1.0);',
    'return (4.0*m4+m2+0.5)/16.0;',
    '}',
    volume
      ? 'bool tbOccInside(vec3 w,vec3 mn,vec3 mx){return w.x>=mn.x&&w.x<=mx.x&&w.y>=mn.y&&w.y<=mx.y&&w.z>=mn.z&&w.z<=mx.z;}'
      : '',
    'void tbOccApply(float vis){',
    'if(vis>=0.999) return;',
    'float bay=tbOccBayer(gl_FragCoord.xy);',
    'vec2 pd=gl_FragCoord.xy-vec2(uTbPx,uTbPy);',
    `if(uTbHole>0.0 && dot(pd,pd)<uTbHole*uTbHole) vis=min(vis,${OCCLUSION.holeVisible.toFixed(2)});`,
    'if(bay>vis) discard;',
    '}',
  ]
    .filter((line) => line.length > 0)
    .join('\n');
}

function fragmentBody(mode: ModeData['tbOccMode']): string {
  const lines: string[] = [];
  if (mode === 'instance' || mode === 'both') lines.push('tbOccApply(vTbOcc);');
  if (mode === 'volume' || mode === 'both') {
    lines.push('if(vTbOcc>=0.999){', volumeTests(), '}');
  }
  return `\n${lines.join('\n')}\n`;
}

function inject(shader: WebGLProgramParametersWithUniforms, mode: ModeData['tbOccMode']): void {
  if (shader.vertexShader.includes('vTbOcc')) return;
  const volume = mode === 'volume' || mode === 'both';
  const vertDecl = [
    '#ifdef USE_INSTANCING',
    'attribute float instanceOcc;',
    '#endif',
    'varying float vTbOcc;',
    volume ? 'varying vec3 vTbOccW;' : '',
  ]
    .filter((line) => line.length > 0)
    .join('\n');
  const vertAssign = [
    '#ifdef USE_INSTANCING',
    'vTbOcc=instanceOcc;',
    volume ? 'vTbOccW=(modelMatrix*instanceMatrix*vec4(transformed,1.0)).xyz;' : '',
    '#else',
    'vTbOcc=1.0;',
    volume ? 'vTbOccW=(modelMatrix*vec4(transformed,1.0)).xyz;' : '',
    '#endif',
  ]
    .filter((line) => line.length > 0)
    .join('\n');
  if (shader.vertexShader.includes('#include <common>')) {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>\n${vertDecl}`,
    );
  } else {
    shader.vertexShader = `${vertDecl}\n${shader.vertexShader}`;
  }
  if (shader.vertexShader.includes('#include <project_vertex>')) {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>\n${vertAssign}`,
    );
  } else {
    shader.vertexShader = shader.vertexShader.replace('gl_Position', `${vertAssign}\ngl_Position`);
  }
  const lib = fragmentLib(volume);
  if (shader.fragmentShader.includes('#include <common>')) {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>\n${lib}`,
    );
  } else {
    shader.fragmentShader = `${lib}\n${shader.fragmentShader}`;
  }
  shader.fragmentShader = shader.fragmentShader.replace(
    /void\s+main\s*\(\s*\)\s*\{/,
    (head) => `${head}${fragmentBody(mode)}`,
  );
  bindUniforms(shader, volume);
}

function ensurePatched(material: Material): void {
  const data = modeOf(material);
  if (data.tbOccPatched) return;
  data.tbOccPatched = true;
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.customProgramCacheKey = function cacheKey(this: Material) {
    return `${prevKey.call(this)}|tbocc|${data.tbOccMode ?? ''}`;
  };
  material.onBeforeCompile = function compile(
    this: Material,
    shader: WebGLProgramParametersWithUniforms,
    renderer: WebGLRenderer,
  ) {
    prev.call(this, shader, renderer);
    inject(shader, data.tbOccMode ?? 'instance');
  };
  material.needsUpdate = true;
}

function requestMode(material: Material, mode: 'instance' | 'volume'): void {
  const data = modeOf(material);
  const next = !data.tbOccMode || data.tbOccMode === mode ? mode : 'both';
  const changed = data.tbOccMode !== next;
  data.tbOccMode = next;
  ensurePatched(material);
  if (changed) material.needsUpdate = true;
}

function protectedChain(obj: Object3D): boolean {
  let node: Object3D | null = obj;
  while (node) {
    const flags = node.userData as {
      tbPerson?: unknown;
      tbNpc?: unknown;
      tbLiveNpc?: unknown;
      tbWagon?: unknown;
    };
    if (
      isProtectedNode(node.name, {
        person: Boolean(flags.tbPerson),
        npc: Boolean(flags.tbNpc || flags.tbLiveNpc),
        wagon: Boolean(flags.tbWagon),
      })
    ) {
      return true;
    }
    node = node.parent;
  }
  return false;
}

function asAabb(box: Box3): Aabb {
  return {
    minX: box.min.x,
    minY: box.min.y,
    minZ: box.min.z,
    maxX: box.max.x,
    maxY: box.max.y,
    maxZ: box.max.z,
  };
}

/** Record building shells and teach their materials the bounds fade. Call before welding. */
export function captureBuildingOccluders(root: Object3D): void {
  root.updateMatrixWorld(true);
  const boxes: Aabb[] = [];
  const materials = new Set<Material>();
  root.traverse((obj) => {
    if (!obj.userData.tbBuilding) return;
    boxScratch.makeEmpty();
    obj.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh || (mesh as InstancedMesh).isInstancedMesh) return;
      const geo = mesh.geometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      const local = geo.boundingBox;
      if (!local) return;
      meshScratch.copy(local).applyMatrix4(mesh.matrixWorld);
      boxScratch.union(meshScratch);
      const mat = mesh.material;
      if (Array.isArray(mat)) {
        for (const one of mat) materials.add(one);
      } else {
        materials.add(mat);
      }
    });
    if (!boxScratch.isEmpty()) boxes.push(asAabb(boxScratch));
  });
  (root.userData as { tbBuildingAabbs?: Aabb[] }).tbBuildingAabbs = boxes;
  for (const material of materials) requestMode(material, 'volume');
}

function localAabb(geo: BufferGeometry): Aabb | null {
  if (!geo.boundingBox) geo.computeBoundingBox();
  const local = geo.boundingBox;
  if (!local) return null;
  return asAabb(local);
}

function bindInstances(root: Object3D, records: OccCandidate[]): void {
  root.traverse((obj) => {
    const mesh = obj as InstancedMesh;
    if (!mesh.isInstancedMesh) return;
    const roleName = typeof mesh.userData.tbOcc === 'string' ? mesh.userData.tbOcc : '';
    if (!isFadeRole(roleName) || protectedChain(mesh)) return;
    const role = roleName;
    const sourceGeo = mesh.geometry;
    const source = localAabb(sourceGeo);
    if (!source || mesh.count < 1) return;
    const keepSource = Boolean(sourceGeo.userData.tbKeep);
    const geo = sourceGeo.clone();
    geo.userData = { ...geo.userData };
    delete geo.userData.tbKeep;
    const data = new Float32Array(mesh.count);
    data.fill(1);
    const attr = new InstancedBufferAttribute(data, 1);
    attr.setUsage(DynamicDrawUsage);
    geo.setAttribute('instanceOcc', attr);
    mesh.geometry = geo;
    if (!keepSource) sourceGeo.dispose();
    mesh.updateMatrixWorld(true);
    const ids: number[] = [];
    const roles: OccRole[] = [];
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, instanceMatrix);
      worldMatrix.multiplyMatrices(mesh.matrixWorld, instanceMatrix);
      const id = records.length;
      const raw = aabbFromMatrix(source, worldMatrix.elements);
      const candidate: OccCandidate = {
        id,
        role,
        bounds: role === 'trunk' ? expandAabb(raw, OCCLUSION.trunkPad) : raw,
      };
      records.push(candidate);
      grid.insert(candidate);
      ids.push(id);
      roles.push(role);
    }
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of mats) requestMode(material, 'instance');
    batches.push({ attr, ids, roles });
  });
}

function bind(root: Object3D): void {
  grid = new OccluderGrid();
  batches = [];
  buildings = [];
  const records: OccCandidate[] = [];
  bindInstances(root, records);
  catalog = records;
  const stored = (root.userData as { tbBuildingAabbs?: Aabb[] }).tbBuildingAabbs ?? [];
  for (const bounds of stored) {
    const id = records.length;
    const candidate: OccCandidate = { id, role: 'building', bounds };
    records.push(candidate);
    buildings.push({ id, bounds });
    grid.insert(candidate);
  }
  fades = new Float32Array(records.length);
}

function writeInstances(): void {
  for (const batch of batches) {
    let dirty = false;
    for (let i = 0; i < batch.ids.length; i++) {
      const id = batch.ids[i];
      const role = batch.roles[i];
      if (id === undefined || !role) continue;
      const vis = visibilityFor(role, fades[id] ?? 0);
      if (Math.abs(batch.attr.getX(i) - vis) <= 0.0005) continue;
      batch.attr.setX(i, vis);
      dirty = true;
    }
    if (dirty) batch.attr.needsUpdate = true;
  }
}

function writeBuildings(camera: Vec3): void {
  const ranked = buildings
    .map((building) => {
      const fade = fades[building.id] ?? 0;
      const cx = (building.bounds.minX + building.bounds.maxX) * 0.5;
      const cy = (building.bounds.minY + building.bounds.maxY) * 0.5;
      const cz = (building.bounds.minZ + building.bounds.maxZ) * 0.5;
      const dx = cx - camera.x;
      const dy = cy - camera.y;
      const dz = cz - camera.z;
      return { building, fade, dist: dx * dx + dy * dy + dz * dz };
    })
    .filter((row) => row.fade > 0.001)
    .sort((a, b) => b.fade - a.fade || a.dist - b.dist);
  const shown = Math.min(BOXES, ranked.length);
  countU.value = shown;
  for (let i = 0; i < BOXES; i++) {
    const slotMin = minU[i];
    const slotMax = maxU[i];
    const slotVis = visU[i];
    if (!slotMin || !slotMax || !slotVis) continue;
    const row = ranked[i];
    if (!row || i >= shown) {
      slotVis.value = 1;
      continue;
    }
    slotMin.value.set(row.building.bounds.minX, row.building.bounds.minY, row.building.bounds.minZ);
    slotMax.value.set(row.building.bounds.maxX, row.building.bounds.maxY, row.building.bounds.maxZ);
    slotVis.value = visibilityFor('building', row.fade);
  }
}

export interface OcclusionFrame {
  scene: Object3D;
  camera: Camera;
  player: Vec3;
  dt: number;
  enabled: boolean;
  viewWidth: number;
  viewHeight: number;
}

function cameraVec(camera: Camera): Vec3 {
  return { x: camera.position.x, y: camera.position.y, z: camera.position.z };
}

export function updateCameraOcclusion(frame: OcclusionFrame): void {
  const root = frame.scene.getObjectByName('tb-area');
  if (!root) return;
  if (root !== boundRoot) {
    bind(root);
    boundRoot = root;
  }
  frame.camera.updateMatrixWorld();
  projected.set(frame.player.x, frame.player.y, frame.player.z);
  projected.project(frame.camera);
  const inFront = projected.z >= -1 && projected.z <= 1;
  pxU.value = (projected.x * 0.5 + 0.5) * Math.max(1, frame.viewWidth);
  pyU.value = (projected.y * 0.5 + 0.5) * Math.max(1, frame.viewHeight);
  holeU.value = inFront ? HOLE_PX : 0;
  const camera = cameraVec(frame.camera);
  const hits = frame.enabled ? grid.collect(camera, frame.player) : [];
  const active = frame.enabled ? linkTreeParts(catalog, hits) : hits;
  advanceFades(fades, active, frame.dt);
  writeInstances();
  writeBuildings(camera);
  let fading = 0;
  for (const value of fades) {
    if (value > 0.02) fading += 1;
  }
  (globalThis as { __tbOcclusion?: OcclusionDebug }).__tbOcclusion = {
    instances: batches.reduce((sum, batch) => sum + batch.ids.length, 0),
    buildings: buildings.length,
    fading,
    enabled: frame.enabled,
  };
}

export interface OcclusionDebug {
  instances: number;
  buildings: number;
  fading: number;
  enabled: boolean;
}
