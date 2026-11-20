/** Module worker: bakes the six globe face textures off the main thread. */
import {
  bakeOneFace,
  makeLayer,
  type PlanetBakeRequest,
  type PlanetBakeResult,
} from './planet-bake';

interface WorkerScope {
  onmessage: ((event: MessageEvent<PlanetBakeRequest>) => void) | null;
  postMessage(message: PlanetBakeResult, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const req = event.data;
  const t0 = performance.now();
  const layer = makeLayer(req);
  const faces: Uint8ClampedArray[] = [];
  for (let f = 0; f < 6; f++) faces.push(bakeOneFace(layer, req, f as 0));
  const result: PlanetBakeResult = { key: req.key, faces, ms: performance.now() - t0 };
  scope.postMessage(
    result,
    faces.map((face) => face.buffer as ArrayBuffer),
  );
};
