// Reconstrução 3D: fusão das vistas capturadas em uma única malha do rosto.
//
// Sistema de coordenadas: X para a direita da imagem, Y para cima, Z saindo da tela em
// direção à câmera. Nesse sistema os triângulos da malha canônica ficam anti-horários
// vistos de frente, então as normais apontam para fora do rosto.

import { TRIANGLES } from './face_topology.js';
import { NUM_LANDMARKS, NUM_MESH_VERTICES, ASSUMED_IPD_MM } from './config.js';
import {
  RIGIDITY, RIGHT_EYE, LEFT_EYE, RIGHT_IRIS, LEFT_IRIS,
  RIGHT_IRIS_CENTER, LEFT_IRIS_CENTER, RIGHT_EYE_OUTER, LEFT_EYE_OUTER,
} from './landmarks.js';
import { similarityAlign, applySimilarity, dist3 } from './math.js';

// Landmarks normalizados do MediaPipe → pontos 3D em pixels.
export function toPixel3D(landmarks, width, height) {
  const P = new Float64Array(NUM_LANDMARKS * 3);
  for (let i = 0; i < NUM_LANDMARKS; i++) {
    const p = landmarks[i];
    P[3 * i] = p.x * width;
    P[3 * i + 1] = -p.y * height;
    P[3 * i + 2] = -p.z * width; // z do MediaPipe diminui em direção à câmera
  }
  return P;
}

// Normais por vértice (ponderadas por área) de uma malha qualquer.
export function computeNormals(positions, triangles, vertexCount) {
  const N = new Float64Array(vertexCount * 3);
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t], b = triangles[t + 1], c = triangles[t + 2];
    const ax = positions[3 * a], ay = positions[3 * a + 1], az = positions[3 * a + 2];
    const e1x = positions[3 * b] - ax, e1y = positions[3 * b + 1] - ay, e1z = positions[3 * b + 2] - az;
    const e2x = positions[3 * c] - ax, e2y = positions[3 * c + 1] - ay, e2z = positions[3 * c + 2] - az;
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    for (const v of [a, b, c]) {
      N[3 * v] += nx; N[3 * v + 1] += ny; N[3 * v + 2] += nz;
    }
  }
  for (let v = 0; v < vertexCount; v++) {
    const l = Math.hypot(N[3 * v], N[3 * v + 1], N[3 * v + 2]) || 1;
    N[3 * v] /= l; N[3 * v + 1] /= l; N[3 * v + 2] /= l;
  }
  return N;
}

// Normais dos 478 landmarks: malha + íris (que herda a normal média do olho).
export function landmarkNormals(P) {
  const mesh = computeNormals(P, TRIANGLES, NUM_MESH_VERTICES);
  const N = new Float64Array(NUM_LANDMARKS * 3);
  N.set(mesh);
  const fill = (iris, eye) => {
    let x = 0, y = 0, z = 0;
    for (const e of eye) { x += mesh[3 * e]; y += mesh[3 * e + 1]; z += mesh[3 * e + 2]; }
    const l = Math.hypot(x, y, z) || 1;
    for (const i of iris) { N[3 * i] = x / l; N[3 * i + 1] = y / l; N[3 * i + 2] = z / l; }
  };
  fill(RIGHT_IRIS, RIGHT_EYE);
  fill(LEFT_IRIS, LEFT_EYE);
  return N;
}

// Quanto cada ponto está virado para a câmera naquela vista (0 = de lado/oculto, 1 = de frente).
export function visibility(N) {
  const v = new Float64Array(NUM_LANDMARKS);
  for (let i = 0; i < NUM_LANDMARKS; i++) v[i] = Math.max(0, N[3 * i + 2]);
  return v;
}

// Pose da cabeça a partir dos próprios landmarks (independe da matriz do MediaPipe).
// yaw > 0: a pessoa virou para a direita dela; pitch > 0: olhou para cima.
export function poseFromLandmarks(P) {
  const R = RIGHT_EYE_OUTER, L = LEFT_EYE_OUTER, TOP = 10, CHIN = 152;
  const xa = [P[3 * L] - P[3 * R], P[3 * L + 1] - P[3 * R + 1], P[3 * L + 2] - P[3 * R + 2]];
  const ya = [P[3 * TOP] - P[3 * CHIN], P[3 * TOP + 1] - P[3 * CHIN + 1], P[3 * TOP + 2] - P[3 * CHIN + 2]];
  const f = [xa[1] * ya[2] - xa[2] * ya[1], xa[2] * ya[0] - xa[0] * ya[2], xa[0] * ya[1] - xa[1] * ya[0]];
  const fl = Math.hypot(f[0], f[1], f[2]) || 1;
  const fx = f[0] / fl, fy = f[1] / fl, fz = f[2] / fl;
  const deg = 180 / Math.PI;
  return {
    yaw: -Math.atan2(fx, fz) * deg,
    pitch: Math.atan2(fy, Math.hypot(fx, fz)) * deg,
    roll: Math.atan2(xa[1], xa[0]) * deg,
  };
}

function weightedRms(A, B, w) {
  let s = 0, sw = 0;
  for (let i = 0; i < w.length; i++) {
    if (!(w[i] > 0)) continue;
    const dx = A[3 * i] - B[3 * i], dy = A[3 * i + 1] - B[3 * i + 1], dz = A[3 * i + 2] - B[3 * i + 2];
    s += w[i] * (dx * dx + dy * dy + dz * dz);
    sw += w[i];
  }
  return sw > 0 ? Math.sqrt(s / sw) : 0;
}

// Procrustes generalizado: alinha todas as vistas ao rosto de referência e faz a média
// ponderada pela visibilidade. Cada ponto é estimado principalmente pelas vistas em que
// aparece de frente (ex.: a lateral do nariz vem dos perfis).
export function fuseViews(views, { iterations = 4 } = {}) {
  const n = NUM_LANDMARKS;
  const frontIndex = Math.max(0, views.findIndex((v) => v.name === 'front'));
  const front = views[frontIndex];
  const vis = views.map((v) => visibility(v.N));
  let template = Float64Array.from(front.P);
  let aligned = [];
  let transforms = [];

  for (let it = 0; it < iterations; it++) {
    transforms = views.map((v, k) => {
      const w = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const base = RIGIDITY[i] * vis[k][i] * vis[k][i];
        w[i] = it === 0 ? base * vis[frontIndex][i] : base;
      }
      return similarityAlign(v.P, template, w);
    });
    aligned = views.map((v, k) => applySimilarity(v.P, transforms[k]));

    const fused = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      let sw = 0, x = 0, y = 0, z = 0;
      for (let k = 0; k < views.length; k++) {
        const w = vis[k][i] ** 3 + (k === frontIndex ? 0.2 : 0) + 1e-6;
        x += w * aligned[k][3 * i]; y += w * aligned[k][3 * i + 1]; z += w * aligned[k][3 * i + 2];
        sw += w;
      }
      fused[3 * i] = x / sw; fused[3 * i + 1] = y / sw; fused[3 * i + 2] = z / sw;
    }
    // Reancora no referencial da vista frontal para não haver deriva entre iterações.
    const anchor = similarityAlign(fused, front.P, RIGIDITY);
    template = applySimilarity(fused, anchor);
  }

  const residuals = views.map((v, k) => {
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = vis[k][i] > 0.3 ? RIGIDITY[i] : 0;
    return weightedRms(aligned[k], template, w);
  });
  return { points: template, transforms, residuals, frontIndex };
}

// Converte o rosto fundido para milímetros (escala estimada pela distância interpupilar média)
// e centraliza na origem.
export function toMillimeters(points) {
  const ipd = dist3(points, RIGHT_IRIS_CENTER, LEFT_IRIS_CENTER);
  const scale = ipd > 0 ? ASSUMED_IPD_MM / ipd : 1;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < NUM_MESH_VERTICES; i++) {
    cx += points[3 * i]; cy += points[3 * i + 1]; cz += points[3 * i + 2];
  }
  cx /= NUM_MESH_VERTICES; cy /= NUM_MESH_VERTICES; cz /= NUM_MESH_VERTICES;
  const out = new Float32Array(points.length);
  for (let i = 0; i < points.length; i += 3) {
    out[i] = (points[i] - cx) * scale;
    out[i + 1] = (points[i + 1] - cy) * scale;
    out[i + 2] = (points[i + 2] - cz) * scale;
  }
  return { points: out, mmPerUnit: scale };
}

// Uma iteração de subdivisão de Loop (suaviza a malha e quadruplica os triângulos).
export function loopSubdivide(positions, uvs, triangles) {
  const nV = positions.length / 3;
  const edges = new Map();
  const neighbors = Array.from({ length: nV }, () => new Set());
  const key = (a, b) => (a < b ? a * 1048576 + b : b * 1048576 + a);
  for (let t = 0; t < triangles.length; t += 3) {
    const tri = [triangles[t], triangles[t + 1], triangles[t + 2]];
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3], c = tri[(e + 2) % 3];
      const k = key(a, b);
      let entry = edges.get(k);
      if (!entry) { entry = { a, b, opposite: [] }; edges.set(k, entry); }
      entry.opposite.push(c);
      neighbors[a].add(b); neighbors[b].add(a);
    }
  }
  const outPos = new Float32Array((nV + edges.size) * 3);
  const outUv = new Float32Array((nV + edges.size) * 2);
  const boundaryNeighbors = Array.from({ length: nV }, () => []);
  let next = nV;
  for (const entry of edges.values()) {
    const { a, b, opposite } = entry;
    entry.id = next++;
    const o = entry.id;
    for (let d = 0; d < 3; d++) {
      if (opposite.length === 2) {
        outPos[3 * o + d] = 0.375 * (positions[3 * a + d] + positions[3 * b + d])
          + 0.125 * (positions[3 * opposite[0] + d] + positions[3 * opposite[1] + d]);
      } else {
        outPos[3 * o + d] = 0.5 * (positions[3 * a + d] + positions[3 * b + d]);
      }
    }
    outUv[2 * o] = 0.5 * (uvs[2 * a] + uvs[2 * b]);
    outUv[2 * o + 1] = 0.5 * (uvs[2 * a + 1] + uvs[2 * b + 1]);
    if (opposite.length === 1) { boundaryNeighbors[a].push(b); boundaryNeighbors[b].push(a); }
  }
  for (let v = 0; v < nV; v++) {
    outUv[2 * v] = uvs[2 * v];
    outUv[2 * v + 1] = uvs[2 * v + 1];
    const bn = boundaryNeighbors[v];
    if (bn.length === 2) {
      for (let d = 0; d < 3; d++) {
        outPos[3 * v + d] = 0.75 * positions[3 * v + d] + 0.125 * (positions[3 * bn[0] + d] + positions[3 * bn[1] + d]);
      }
      continue;
    }
    const nb = [...neighbors[v]];
    const k = nb.length;
    const beta = k > 3 ? 3 / (8 * k) : 3 / 16;
    for (let d = 0; d < 3; d++) {
      let s = 0;
      for (const u of nb) s += positions[3 * u + d];
      outPos[3 * v + d] = (1 - k * beta) * positions[3 * v + d] + beta * s;
    }
  }
  const outTri = new Uint32Array(triangles.length * 4);
  let w = 0;
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t], b = triangles[t + 1], c = triangles[t + 2];
    const ab = edges.get(key(a, b)).id, bc = edges.get(key(b, c)).id, ca = edges.get(key(c, a)).id;
    outTri.set([a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca], w);
    w += 12;
  }
  return { positions: outPos, uvs: outUv, triangles: outTri };
}

// Vizinhança de cada vértice da malha (usada em curvatura e suavização).
export function meshNeighbors(triangles = TRIANGLES, vertexCount = NUM_MESH_VERTICES) {
  const nb = Array.from({ length: vertexCount }, () => new Set());
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t], b = triangles[t + 1], c = triangles[t + 2];
    nb[a].add(b); nb[a].add(c); nb[b].add(a); nb[b].add(c); nb[c].add(a); nb[c].add(b);
  }
  return nb.map((s) => [...s]);
}

// Medidas aproximadas (em mm) a partir do rosto fundido.
export function faceMeasurements(pointsMm) {
  const d = (i, j) => dist3(pointsMm, i, j);
  const cheekZ = (pointsMm[3 * 234 + 2] + pointsMm[3 * 454 + 2]) / 2;
  return {
    faceWidth: d(234, 454),
    faceHeight: d(10, 152),
    eyeCornerDistance: d(RIGHT_EYE_OUTER, LEFT_EYE_OUTER),
    noseLength: d(168, 2),
    noseWidth: d(98, 327),
    mouthWidth: d(61, 291),
    noseDepth: pointsMm[3 * 1 + 2] - cheekZ,
  };
}
