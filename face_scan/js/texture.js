// Geração da textura do rosto 3D a partir de várias fotos.
//
// Cada texel do mapa UV canônico é projetado em todas as vistas; a cor final é a média
// ponderada pelo quanto aquela região estava de frente para a câmera em cada foto. Um
// z-buffer por vista descarta pixels ocultos (ex.: bochecha escondida atrás do nariz).

import { TRIANGLES, UVS } from './face_topology.js';
import { NUM_MESH_VERTICES } from './config.js';
import { dist3 } from './math.js';

const DEPTH_SCALE = 0.25;

function rasterizeDepth(view) {
  const W = Math.ceil(view.width * DEPTH_SCALE), H = Math.ceil(view.height * DEPTH_SCALE);
  const depth = new Float32Array(W * H).fill(-Infinity);
  const P = view.P;
  for (let t = 0; t < TRIANGLES.length; t += 3) {
    const ids = [TRIANGLES[t], TRIANGLES[t + 1], TRIANGLES[t + 2]];
    const xs = ids.map((i) => P[3 * i] * DEPTH_SCALE);
    const ys = ids.map((i) => -P[3 * i + 1] * DEPTH_SCALE);
    const zs = ids.map((i) => P[3 * i + 2]);
    const area = (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0]);
    if (Math.abs(area) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(W - 1, Math.ceil(Math.max(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(H - 1, Math.ceil(Math.max(...ys)));
    for (let y = y0; y <= y1; y++) {
      const sy = y + 0.5;
      for (let x = x0; x <= x1; x++) {
        const sx = x + 0.5;
        const b0 = ((xs[1] - sx) * (ys[2] - sy) - (xs[2] - sx) * (ys[1] - sy)) / area;
        const b1 = ((xs[2] - sx) * (ys[0] - sy) - (xs[0] - sx) * (ys[2] - sy)) / area;
        const b2 = 1 - b0 - b1;
        if (b0 < -0.01 || b1 < -0.01 || b2 < -0.01) continue;
        const z = b0 * zs[0] + b1 * zs[1] + b2 * zs[2];
        const k = y * W + x;
        if (z > depth[k]) depth[k] = z;
      }
    }
  }
  return { depth, W, H };
}

function sampleRGB(data, W, H, x, y, out) {
  x -= 0.5; y -= 0.5;
  if (x < 0) x = 0; if (y < 0) y = 0;
  if (x > W - 1.001) x = W - 1.001; if (y > H - 1.001) y = H - 1.001;
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
  const i00 = (y0 * W + x0) * 4, i10 = i00 + 4, i01 = i00 + W * 4, i11 = i01 + 4;
  const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
  out[0] = data[i00] * w00 + data[i10] * w10 + data[i01] * w01 + data[i11] * w11;
  out[1] = data[i00 + 1] * w00 + data[i10 + 1] * w10 + data[i01 + 1] * w01 + data[i11 + 1] * w11;
  out[2] = data[i00 + 2] * w00 + data[i10 + 2] * w10 + data[i01 + 2] * w01 + data[i11 + 2] * w11;
}

function prepareView(view, isFront) {
  const { P, N, width, height } = view;
  const weight = new Float32Array(NUM_MESH_VERTICES);
  for (let i = 0; i < NUM_MESH_VERTICES; i++) {
    const vis = N[3 * i + 2];
    const x = P[3 * i], y = -P[3 * i + 1];
    const inside = x >= 1 && y >= 1 && x <= width - 2 && y <= height - 2;
    weight[i] = vis > 0.08 && inside ? vis ** 5 * (isFront ? 1.15 : 1) : 0;
  }
  const iod = dist3(P, 33, 263);
  return { ...view, weight, depthBuffer: rasterizeDepth(view), depthTolerance: 0.05 * iod };
}

// Ajuste de exposição: iguala o brilho de cada vista ao da foto frontal nos pontos que ambas veem bem.
function exposureGains(views, frontIndex) {
  const front = views[frontIndex];
  const a = [0, 0, 0], b = [0, 0, 0];
  return views.map((view, k) => {
    if (k === frontIndex) return [1, 1, 1];
    const sf = [0, 0, 0], sk = [0, 0, 0];
    let count = 0;
    for (let i = 0; i < NUM_MESH_VERTICES; i++) {
      if (front.N[3 * i + 2] < 0.55 || view.N[3 * i + 2] < 0.55) continue;
      sampleRGB(front.image.data, front.width, front.height, front.P[3 * i], -front.P[3 * i + 1], a);
      sampleRGB(view.image.data, view.width, view.height, view.P[3 * i], -view.P[3 * i + 1], b);
      for (let c = 0; c < 3; c++) { sf[c] += a[c]; sk[c] += b[c]; }
      count++;
    }
    if (count < 15) return [1, 1, 1];
    return sf.map((v, c) => Math.min(1.6, Math.max(0.6, v / Math.max(1, sk[c]))));
  });
}

function dilate(rgba, filled, size, iterations) {
  const idx = [];
  for (let it = 0; it < iterations; it++) {
    idx.length = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const k = y * size + x;
        if (filled[k]) continue;
        let r = 0, g = 0, b = 0, n = 0;
        if (x > 0 && filled[k - 1]) { r += rgba[4 * (k - 1)]; g += rgba[4 * (k - 1) + 1]; b += rgba[4 * (k - 1) + 2]; n++; }
        if (x < size - 1 && filled[k + 1]) { r += rgba[4 * (k + 1)]; g += rgba[4 * (k + 1) + 1]; b += rgba[4 * (k + 1) + 2]; n++; }
        if (y > 0 && filled[k - size]) { r += rgba[4 * (k - size)]; g += rgba[4 * (k - size) + 1]; b += rgba[4 * (k - size) + 2]; n++; }
        if (y < size - 1 && filled[k + size]) { r += rgba[4 * (k + size)]; g += rgba[4 * (k + size) + 1]; b += rgba[4 * (k + size) + 2]; n++; }
        if (n) idx.push(k, r / n, g / n, b / n);
      }
    }
    for (let j = 0; j < idx.length; j += 4) {
      const k = idx[j];
      rgba[4 * k] = idx[j + 1]; rgba[4 * k + 1] = idx[j + 2]; rgba[4 * k + 2] = idx[j + 3]; rgba[4 * k + 3] = 255;
      filled[k] = 1;
    }
  }
}

// views: [{ name, image: ImageData, width, height, P (pixels 3D), N (normais) }]
// Retorna { data: Uint8ClampedArray RGBA, size, coverage }.
export function bakeTexture(rawViews, size, frontIndex = 0) {
  const views = rawViews.map((v, k) => prepareView(v, k === frontIndex));
  const gains = exposureGains(views, frontIndex);
  views.forEach((v, k) => { v.gain = gains[k]; });
  const acc = new Float32Array(size * size * 4);
  const rgb = [0, 0, 0];

  for (let t = 0; t < TRIANGLES.length; t += 3) {
    const ids = [TRIANGLES[t], TRIANGLES[t + 1], TRIANGLES[t + 2]];
    const us = ids.map((i) => UVS[2 * i] * size);
    const vs = ids.map((i) => (1 - UVS[2 * i + 1]) * size);
    const area = (us[1] - us[0]) * (vs[2] - vs[0]) - (us[2] - us[0]) * (vs[1] - vs[0]);
    if (Math.abs(area) < 1e-9) continue;
    const active = views.filter((v) => v.weight[ids[0]] + v.weight[ids[1]] + v.weight[ids[2]] > 1e-4);
    if (!active.length) continue;
    const x0 = Math.max(0, Math.floor(Math.min(...us))), x1 = Math.min(size - 1, Math.ceil(Math.max(...us)));
    const y0 = Math.max(0, Math.floor(Math.min(...vs))), y1 = Math.min(size - 1, Math.ceil(Math.max(...vs)));
    for (let y = y0; y <= y1; y++) {
      const sy = y + 0.5;
      for (let x = x0; x <= x1; x++) {
        const sx = x + 0.5;
        const b0 = ((us[1] - sx) * (vs[2] - sy) - (us[2] - sx) * (vs[1] - sy)) / area;
        const b1 = ((us[2] - sx) * (vs[0] - sy) - (us[0] - sx) * (vs[2] - sy)) / area;
        const b2 = 1 - b0 - b1;
        if (b0 < -0.02 || b1 < -0.02 || b2 < -0.02) continue;
        const k = 4 * (y * size + x);
        for (const v of active) {
          const w = b0 * v.weight[ids[0]] + b1 * v.weight[ids[1]] + b2 * v.weight[ids[2]];
          if (w <= 1e-5) continue;
          const P = v.P;
          const px = b0 * P[3 * ids[0]] + b1 * P[3 * ids[1]] + b2 * P[3 * ids[2]];
          const py = -(b0 * P[3 * ids[0] + 1] + b1 * P[3 * ids[1] + 1] + b2 * P[3 * ids[2] + 1]);
          const pz = b0 * P[3 * ids[0] + 2] + b1 * P[3 * ids[1] + 2] + b2 * P[3 * ids[2] + 2];
          const db = v.depthBuffer;
          const dx = Math.min(db.W - 1, Math.max(0, (px * DEPTH_SCALE) | 0));
          const dy = Math.min(db.H - 1, Math.max(0, (py * DEPTH_SCALE) | 0));
          if (pz < db.depth[dy * db.W + dx] - v.depthTolerance) continue;
          sampleRGB(v.image.data, v.width, v.height, px, py, rgb);
          const g = v.gain;
          acc[k] += w * rgb[0] * g[0];
          acc[k + 1] += w * rgb[1] * g[1];
          acc[k + 2] += w * rgb[2] * g[2];
          acc[k + 3] += w;
        }
      }
    }
  }

  const data = new Uint8ClampedArray(size * size * 4);
  const filled = new Uint8Array(size * size);
  let count = 0, mr = 0, mg = 0, mb = 0;
  for (let k = 0; k < size * size; k++) {
    const w = acc[4 * k + 3];
    if (w <= 0) continue;
    data[4 * k] = acc[4 * k] / w;
    data[4 * k + 1] = acc[4 * k + 1] / w;
    data[4 * k + 2] = acc[4 * k + 2] / w;
    data[4 * k + 3] = 255;
    filled[k] = 1;
    mr += data[4 * k]; mg += data[4 * k + 1]; mb += data[4 * k + 2];
    count++;
  }
  const coverage = count / (size * size);
  dilate(data, filled, size, 6);
  if (count) {
    // O resto do atlas recebe a cor média da pele para evitar bordas escuras no filtro bilinear.
    mr /= count; mg /= count; mb /= count;
    for (let k = 0; k < size * size; k++) {
      if (filled[k]) continue;
      data[4 * k] = mr; data[4 * k + 1] = mg; data[4 * k + 2] = mb; data[4 * k + 3] = 255;
    }
  }
  return { data, size, coverage, gains };
}
