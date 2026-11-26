/* Continuous settlement walls. Palisades are close-set pointed logs.
   Stone curtains are crenellated and about 5 m tall. Gatehouses are an
   opening the road can pass through. Pixel timber and stone, no black. */
(function () {
  const TEX = {};

  function pixelTex(kind) {
    if (TEX[kind]) return TEX[kind];
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 32;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    if (kind === 'wood') {
      g.fillStyle = '#6b4423';
      g.fillRect(0, 0, 32, 32);
      for (let x = 0; x < 32; x += 8) {
        g.fillStyle = x % 16 ? '#8d5a32' : '#7a4e2a';
        g.fillRect(x, 0, 7, 32);
        g.fillStyle = '#c4a574';
        g.fillRect(x + 2, 0, 1, 32);
      }
    } else if (kind === 'hedge') {
      g.fillStyle = '#3f7a3a';
      g.fillRect(0, 0, 32, 32);
      g.fillStyle = '#5a9a46';
      for (let i = 0; i < 12; i++) g.fillRect((i * 7) % 32, (i * 5) % 28, 6, 5);
    } else {
      g.fillStyle = '#5c4a3c';
      g.fillRect(0, 0, 32, 32);
      for (let y = 0; y < 32; y += 8) {
        const shift = (y / 8) % 2 ? 4 : 0;
        for (let x = -4; x < 32; x += 8) {
          g.fillStyle = ((x + y) / 4) % 2 ? '#a89078' : '#7a6554';
          g.fillRect(x + shift, y, 7, 6);
        }
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshLambertMaterial({ map: tex });
    mat.toneMapped = false;
    TEX[kind] = mat;
    return mat;
  }

  function sit(geo) {
    geo.computeBoundingBox();
    geo.translate(0, -geo.boundingBox.min.y, 0);
    return geo;
  }

  function merge(parts) {
    try {
      const utils = THREE.BufferGeometryUtils;
      if (!utils || !utils.mergeGeometries) return parts[0];
      const ready = parts.map(function (geo) {
        return geo.index ? geo.toNonIndexed() : geo;
      });
      return utils.mergeGeometries(ready, false) || parts[0];
    } catch (e) {
      return parts[0];
    }
  }

  function postGeo() {
    const shaft = new THREE.CylinderGeometry(0.34, 0.42, 2.55, 6);
    shaft.translate(0, 1.28, 0);
    const tip = new THREE.ConeGeometry(0.46, 0.75, 6);
    tip.translate(0, 2.9, 0);
    return sit(merge([shaft, tip]));
  }

  function curtainGeo() {
    const wall = new THREE.BoxGeometry(3, 4.55, 3.6);
    wall.translate(0, 2.28, 0);
    const merlons = [];
    for (let i = 0; i < 3; i++) {
      const m = new THREE.BoxGeometry(0.62, 0.7, 3.6);
      m.translate(-1.05 + i * 1.05, 4.9, 0);
      merlons.push(m);
    }
    const parts = [wall].concat(merlons);
    return sit(merge(parts));
  }

  function towerGeo() {
    const body = new THREE.BoxGeometry(4.2, 6.1, 4.2);
    body.translate(0, 3.05, 0);
    const cap = new THREE.BoxGeometry(4.6, 0.45, 4.6);
    cap.translate(0, 6.3, 0);
    return sit(merge([body, cap]));
  }

  function gateGeo() {
    const left = new THREE.BoxGeometry(1.55, 5.8, 2.8);
    left.translate(-4.35, 2.9, 0);
    const right = new THREE.BoxGeometry(1.55, 5.8, 2.8);
    right.translate(4.35, 2.9, 0);
    const lintel = new THREE.BoxGeometry(10.4, 1.25, 2.9);
    lintel.translate(0, 6.15, 0);
    const walk = new THREE.BoxGeometry(10.8, 0.42, 3.1);
    walk.translate(0, 6.95, 0);
    const merlonL = new THREE.BoxGeometry(1.35, 0.7, 2.9);
    merlonL.translate(-2.5, 7.5, 0);
    const merlonR = new THREE.BoxGeometry(1.35, 0.7, 2.9);
    merlonR.translate(2.5, 7.5, 0);
    return sit(merge([left, right, lintel, walk, merlonL, merlonR]));
  }

  function hedgeGeo() {
    const geo = new THREE.BoxGeometry(2.4, 1.5, 0.8);
    geo.translate(0, 0.75, 0);
    return geo;
  }

  function localOf(x, y, origin, meters) {
    const m = meters || 1;
    return { x: (x - (origin.x || 0)) * m, z: (y - (origin.y || 0)) * m };
  }

  /* Local +X follows the wall. Three.js yaw sends +X to (cos θ, -sin θ). */
  function wallYaw(dx, dy) {
    const len = Math.hypot(dx, dy) || 1;
    return Math.atan2(-dy / len, dx / len);
  }

  function addInstances(group, geo, mat, items, groundY) {
    if (!items.length) return;
    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const y = groundY ? groundY(it.x, it.z) || 0 : 0;
      dummy.position.set(it.x, y, it.z);
      dummy.rotation.set(0, it.yaw || 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.userData.tbKeep = 1;
    mesh.userData.tbWall = 1;
    group.add(mesh);
  }

  function nearest(items, gate) {
    let best = Infinity;
    for (let i = 0; i < items.length; i++) {
      const d = Math.hypot(items[i].x - gate.x, items[i].z - gate.z);
      if (d < best) best = d;
    }
    return best;
  }

  function walk(points, step, origin, meters, into) {
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (!(len > 0.3)) continue;
      const yaw = wallYaw(dx, dy);
      const n = Math.max(1, Math.round(len / step));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const p = localOf(a[0] + dx * t, a[1] + dy * t, origin, meters);
        into.push({ x: p.x, z: p.z, yaw: yaw });
        if (into.length > 8000) return;
      }
    }
  }

  function place(parent, groundY, payload, meters) {
    if (!parent || typeof THREE === 'undefined') return null;
    const segments = (payload && payload.segments) || [];
    if (!segments.length) return null;
    const origin = (payload.area && payload.area.innerOrigin) || { x: 0, y: 0 };
    const posts = [];
    const curtains = [];
    const hedges = [];
    const towers = [];
    for (let s = 0; s < segments.length; s++) {
      const segment = segments[s];
      if (!segment || !segment.points || segment.points.length < 2) continue;
      if (segment.kind === 'wall') {
        walk(segment.points, 3, origin, meters, curtains);
        let walked = 0;
        let next = 40;
        const pts = segment.points;
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1];
          const b = pts[i];
          const dx = b[0] - a[0];
          const dy = b[1] - a[1];
          const len = Math.hypot(dx, dy);
          while (walked + len >= next) {
            const t = (next - walked) / (len || 1);
            const p = localOf(a[0] + dx * t, a[1] + dy * t, origin, meters);
            towers.push({ x: p.x, z: p.z, yaw: wallYaw(dx, dy) });
            next += 40;
          }
          walked += len;
        }
      } else if (segment.kind === 'hedge') {
        walk(segment.points, 2.2, origin, meters, hedges);
      } else {
        walk(segment.points, 0.48, origin, meters, posts);
      }
    }
    const stoneGates = [];
    const timberGates = [];
    (payload.props || []).forEach(function (p) {
      if (!p || p.kit !== 'civ_wall_gatehouse_9x6') return;
      const loc = localOf(+p.x, +p.y, origin, meters);
      const rot = ((+p.rot || 0) - 90) * Math.PI / 180;
      const gate = { x: loc.x, z: loc.z, yaw: rot };
      const wood = nearest(posts, gate) + 2 < nearest(curtains, gate);
      (wood ? timberGates : stoneGates).push(gate);
    });
    const allGates = stoneGates.concat(timberGates);
    const open = function (items, radius) {
      if (!allGates.length) return items;
      return items.filter(function (it) {
        for (let i = 0; i < allGates.length; i++) {
          if (Math.hypot(it.x - allGates[i].x, it.z - allGates[i].z) < radius) return false;
        }
        return true;
      });
    };
    const postRun = open(posts, 5.2);
    const curtainRun = open(curtains, 6.2);
    const towerRun = open(towers, 9);
    const group = new THREE.Group();
    group.name = 'tb-area-walls';
    addInstances(group, postGeo(), pixelTex('wood'), postRun, groundY);
    addInstances(group, curtainGeo(), pixelTex('stone'), curtainRun, groundY);
    addInstances(group, towerGeo(), pixelTex('stone'), towerRun, groundY);
    addInstances(group, gateGeo(), pixelTex('stone'), stoneGates, groundY);
    addInstances(group, gateGeo(), pixelTex('wood'), timberGates, groundY);
    addInstances(group, hedgeGeo(), pixelTex('hedge'), hedges, groundY);
    if (!group.children.length) return null;
    parent.add(group);
    window.TBWalls.counts = {
      posts: postRun.length,
      curtains: curtainRun.length,
      towers: towerRun.length,
      gates: stoneGates.length + timberGates.length,
      hedges: hedges.length,
    };
    return group;
  }

  window.TBWalls = { place: place };
})();
