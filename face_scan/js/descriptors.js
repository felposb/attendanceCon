// Descritor de alta dimensão para cada um dos 478 pontos da face.
//
// Layout de cada vetor (2362 valores float32):
//   [0..39]     bloco geométrico (posição 3D fundida, normal, curvatura, distâncias a 32 âncoras)
//   [40..2361]  9 blocos de aparência de 258 valores, um por vista capturada, na ordem VIEW_SLOTS:
//                 [0]        visibilidade do ponto naquela foto (0 = não visível → bloco zerado)
//                 [1..128]   histograma de gradientes orientados 4×4×8 (estilo SIFT)
//                 [129..192] recorte 8×8 de intensidade normalizada
//                 [193..251] histograma de padrões binários locais uniformes (LBP, 59 bins)
//                 [252..257] média e desvio padrão de R, G, B
// Os recortes são alinhados à linha dos olhos e escalados pela distância entre os olhos em 3D,
// então o descritor é invariante a distância da câmera e inclinação da cabeça.

import { NUM_LANDMARKS, NUM_MESH_VERTICES } from './config.js';
import { ANCHORS, NOSE_TIP, RIGHT_EYE_OUTER, LEFT_EYE_OUTER } from './landmarks.js';
import { meshNeighbors } from './reconstruct.js';
import { dist3, jacobiEigen, seededRandom, gaussianRandom } from './math.js';

export const VIEW_SLOTS = ['front', 'left', 'right', 'up', 'down', 'up_left', 'up_right', 'down_left', 'down_right'];
export const GEOMETRY_DIM = 40;
export const VIEW_DIM = 258;
export const DESCRIPTOR_DIM = GEOMETRY_DIM + VIEW_SLOTS.length * VIEW_DIM;

const PATCH = 16;
const PATCH_RADIUS = 0.12; // fração da distância entre os cantos externos dos olhos

export const DESCRIPTOR_LAYOUT = {
  dim: DESCRIPTOR_DIM,
  geometry: {
    offset: 0,
    size: GEOMETRY_DIM,
    fields: {
      position: [0, 3], normal: [3, 6], curvature: [6, 7], nose_tip_distance: [7, 8], anchor_distances: [8, 40],
    },
    anchors: ANCHORS,
  },
  views: VIEW_SLOTS.map((name, s) => ({ name, offset: GEOMETRY_DIM + s * VIEW_DIM, size: VIEW_DIM })),
  view_fields: {
    visibility: [0, 1], gradient_histogram: [1, 129], intensity_patch: [129, 193], lbp_histogram: [193, 252], color_stats: [252, 258],
  },
};

// Tabela de LBP uniforme: 58 padrões com no máximo 2 transições + 1 bin para o resto.
const LBP_UNIFORM = (() => {
  const table = new Uint8Array(256);
  let next = 0;
  for (let code = 0; code < 256; code++) {
    let transitions = 0;
    for (let b = 0; b < 8; b++) {
      if (((code >> b) & 1) !== ((code >> ((b + 1) % 8)) & 1)) transitions++;
    }
    table[code] = transitions <= 2 ? next++ : 58;
  }
  return table;
})();
const LBP_OFFSETS = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];

export function toGray(image) {
  const { data, width, height } = image;
  const gray = new Float32Array(width * height);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
    gray[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
  }
  return gray;
}

function sampleGray(gray, W, H, x, y) {
  x -= 0.5; y -= 0.5;
  if (x < 0) x = 0; if (y < 0) y = 0;
  if (x > W - 1.001) x = W - 1.001; if (y > H - 1.001) y = H - 1.001;
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
  const i = y0 * W + x0;
  return gray[i] * (1 - fx) * (1 - fy) + gray[i + 1] * fx * (1 - fy) + gray[i + W] * (1 - fx) * fy + gray[i + W + 1] * fx * fy;
}

function sampleChannel(data, W, H, x, y, c) {
  x -= 0.5; y -= 0.5;
  if (x < 0) x = 0; if (y < 0) y = 0;
  if (x > W - 1.001) x = W - 1.001; if (y > H - 1.001) y = H - 1.001;
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
  const i = (y0 * W + x0) * 4 + c;
  return data[i] * (1 - fx) * (1 - fy) + data[i + 4] * fx * (1 - fy)
    + data[i + 4 * W] * (1 - fx) * fy + data[i + 4 * W + 4] * fx * fy;
}

function normalizeL2(out, from, to, clip) {
  let n = 0;
  for (let i = from; i < to; i++) n += out[i] * out[i];
  n = Math.sqrt(n);
  if (n < 1e-9) return;
  for (let i = from; i < to; i++) out[i] /= n;
  if (clip) {
    let m = 0;
    for (let i = from; i < to; i++) { if (out[i] > clip) out[i] = clip; m += out[i] * out[i]; }
    m = Math.sqrt(m);
    if (m > 1e-9) for (let i = from; i < to; i++) out[i] /= m;
  }
}

// Geometria da vista: centro do recorte, escala e rotação alinhadas aos olhos.
function viewFrame(view) {
  const P = view.P;
  const iod = dist3(P, RIGHT_EYE_OUTER, LEFT_EYE_OUTER);
  const ex = P[3 * LEFT_EYE_OUTER] - P[3 * RIGHT_EYE_OUTER];
  const ey = -(P[3 * LEFT_EYE_OUTER + 1] - P[3 * RIGHT_EYE_OUTER + 1]);
  const angle = Math.atan2(ey, ex);
  return { radius: PATCH_RADIUS * iod, cos: Math.cos(angle), sin: Math.sin(angle) };
}

// Extrai o recorte orientado (16×16) em torno de um ponto; usado também pela interface.
export function samplePatch(view, frame, index, patch = new Float32Array(PATCH * PATCH)) {
  const cx = view.P[3 * index], cy = -view.P[3 * index + 1];
  const { radius, cos, sin } = frame;
  const half = (PATCH - 1) / 2;
  for (let gy = 0; gy < PATCH; gy++) {
    const v = ((gy - half) / half) * radius;
    for (let gx = 0; gx < PATCH; gx++) {
      const u = ((gx - half) / half) * radius;
      patch[gy * PATCH + gx] = sampleGray(view.gray, view.width, view.height, cx + u * cos - v * sin, cy + u * sin + v * cos);
    }
  }
  return patch;
}

function describeView(view, frame, index, out, offset, patch) {
  const vis = Math.max(0, view.N[3 * index + 2]);
  const cx = view.P[3 * index], cy = -view.P[3 * index + 1];
  const inside = cx > 2 && cy > 2 && cx < view.width - 3 && cy < view.height - 3;
  if (vis < 0.15 || !inside) return; // bloco fica zerado
  out[offset] = vis;
  samplePatch(view, frame, index, patch);

  // Histograma de gradientes orientados (4×4 células × 8 orientações).
  const hist = offset + 1;
  const sigma2 = 2 * 8 * 8;
  for (let y = 0; y < PATCH; y++) {
    for (let x = 0; x < PATCH; x++) {
      const xl = patch[y * PATCH + Math.max(0, x - 1)], xr = patch[y * PATCH + Math.min(PATCH - 1, x + 1)];
      const yu = patch[Math.max(0, y - 1) * PATCH + x], yd = patch[Math.min(PATCH - 1, y + 1) * PATCH + x];
      const dx = xr - xl, dy = yd - yu;
      const mag = Math.hypot(dx, dy) * Math.exp(-((x - 7.5) ** 2 + (y - 7.5) ** 2) / sigma2);
      if (mag < 1e-6) continue;
      const bin = ((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * 8;
      const b0 = Math.floor(bin) % 8, frac = bin - Math.floor(bin), b1 = (b0 + 1) % 8;
      const cell = ((y >> 2) * 4 + (x >> 2)) * 8;
      out[hist + cell + b0] += mag * (1 - frac);
      out[hist + cell + b1] += mag * frac;
    }
  }
  normalizeL2(out, hist, hist + 128, 0.2);

  // Recorte 8×8 de intensidade (média zero, norma unitária).
  const intensity = offset + 129;
  let mean = 0;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const i = 2 * y * PATCH + 2 * x;
      const v = (patch[i] + patch[i + 1] + patch[i + PATCH] + patch[i + PATCH + 1]) / 4;
      out[intensity + y * 8 + x] = v;
      mean += v;
    }
  }
  mean /= 64;
  for (let i = 0; i < 64; i++) out[intensity + i] -= mean;
  normalizeL2(out, intensity, intensity + 64, 0);

  // LBP uniforme.
  const lbp = offset + 193;
  for (let y = 1; y < PATCH - 1; y++) {
    for (let x = 1; x < PATCH - 1; x++) {
      const c = patch[y * PATCH + x];
      let code = 0;
      for (let b = 0; b < 8; b++) {
        const [ox, oy] = LBP_OFFSETS[b];
        if (patch[(y + oy) * PATCH + x + ox] >= c) code |= 1 << b;
      }
      out[lbp + LBP_UNIFORM[code]] += 1 / 196;
    }
  }

  // Estatísticas de cor em uma grade 8×8.
  const color = offset + 252;
  const { radius, cos, sin } = frame;
  const sum = [0, 0, 0], sq = [0, 0, 0];
  for (let gy = 0; gy < 8; gy++) {
    const v = ((gy - 3.5) / 3.5) * radius;
    for (let gx = 0; gx < 8; gx++) {
      const u = ((gx - 3.5) / 3.5) * radius;
      const x = cx + u * cos - v * sin, y = cy + u * sin + v * cos;
      for (let c = 0; c < 3; c++) {
        const s = sampleChannel(view.image.data, view.width, view.height, x, y, c) / 255;
        sum[c] += s; sq[c] += s * s;
      }
    }
  }
  for (let c = 0; c < 3; c++) {
    const m = sum[c] / 64;
    out[color + c] = m;
    out[color + 3 + c] = Math.sqrt(Math.max(0, sq[c] / 64 - m * m));
  }
}

function describeGeometry(fused, normals, neighbors, index, out, offset, iod, center) {
  const P = fused;
  out[offset] = (P[3 * index] - center[0]) / iod;
  out[offset + 1] = (P[3 * index + 1] - center[1]) / iod;
  out[offset + 2] = (P[3 * index + 2] - center[2]) / iod;
  out[offset + 3] = normals[3 * index];
  out[offset + 4] = normals[3 * index + 1];
  out[offset + 5] = normals[3 * index + 2];
  if (index < NUM_MESH_VERTICES) {
    const nb = neighbors[index];
    let mx = 0, my = 0, mz = 0;
    for (const j of nb) { mx += P[3 * j]; my += P[3 * j + 1]; mz += P[3 * j + 2]; }
    mx /= nb.length; my /= nb.length; mz /= nb.length;
    out[offset + 6] = 10 * (((P[3 * index] - mx) * normals[3 * index]
      + (P[3 * index + 1] - my) * normals[3 * index + 1]
      + (P[3 * index + 2] - mz) * normals[3 * index + 2]) / iod);
  }
  out[offset + 7] = dist3(P, index, NOSE_TIP) / iod;
  for (let a = 0; a < ANCHORS.length; a++) out[offset + 8 + a] = dist3(P, index, ANCHORS[a]) / iod;
}

// views: [{ name, image: ImageData, width, height, P, N }] — `gray` é calculado se faltar.
// fused/normals: pontos e normais do rosto fundido (478×3).
export async function computeDescriptors({ fused, normals, views, onProgress }) {
  const out = new Float32Array(NUM_LANDMARKS * DESCRIPTOR_DIM);
  const neighbors = meshNeighbors();
  const iod = dist3(fused, RIGHT_EYE_OUTER, LEFT_EYE_OUTER);
  const center = [0, 0, 0];
  for (let i = 0; i < NUM_MESH_VERTICES; i++) for (let d = 0; d < 3; d++) center[d] += fused[3 * i + d] / NUM_MESH_VERTICES;
  const slots = VIEW_SLOTS.map((name) => views.find((v) => v.name === name) || null);
  for (const v of views) if (!v.gray) v.gray = toGray(v.image);
  const frames = slots.map((v) => (v ? viewFrame(v) : null));
  const patch = new Float32Array(PATCH * PATCH);

  for (let i = 0; i < NUM_LANDMARKS; i++) {
    const base = i * DESCRIPTOR_DIM;
    describeGeometry(fused, normals, neighbors, i, out, base, iod, center);
    for (let s = 0; s < slots.length; s++) {
      if (slots[s]) describeView(slots[s], frames[s], i, out, base + GEOMETRY_DIM + s * VIEW_DIM, patch);
    }
    if (onProgress && i % 60 === 59) {
      onProgress((i + 1) / NUM_LANDMARKS);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  onProgress?.(1);
  return out;
}

// Projeta os descritores em 3 componentes principais (PCA aleatorizado) → cores RGB por ponto.
// Pontos com vetores parecidos recebem cores parecidas.
export function descriptorColors(desc, count = NUM_LANDMARKS, dim = DESCRIPTOR_DIM, sketch = 12) {
  const mean = new Float64Array(dim);
  for (let i = 0; i < count; i++) for (let d = 0; d < dim; d++) mean[d] += desc[i * dim + d] / count;
  const rand = seededRandom(478);
  const omega = new Float64Array(dim * sketch);
  for (let j = 0; j < omega.length; j++) omega[j] = gaussianRandom(rand);
  const Y = new Float64Array(count * sketch);
  for (let i = 0; i < count; i++) {
    for (let d = 0; d < dim; d++) {
      const x = desc[i * dim + d] - mean[d];
      if (x === 0) continue;
      for (let k = 0; k < sketch; k++) Y[i * sketch + k] += x * omega[d * sketch + k];
    }
  }
  const C = Array.from({ length: sketch }, () => new Array(sketch).fill(0));
  for (let i = 0; i < count; i++) {
    for (let a = 0; a < sketch; a++) for (let b = 0; b < sketch; b++) C[a][b] += Y[i * sketch + a] * Y[i * sketch + b];
  }
  const { values, vectors } = jacobiEigen(C);
  const order = values.map((v, j) => [v, j]).sort((p, q) => q[0] - p[0]).slice(0, 3).map((p) => p[1]);
  const colors = new Float32Array(count * 3);
  order.forEach((col, c) => {
    const proj = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      let s = 0;
      for (let k = 0; k < sketch; k++) s += Y[i * sketch + k] * vectors[k][col];
      proj[i] = s;
    }
    const sorted = Float64Array.from(proj).sort();
    const lo = sorted[Math.floor(count * 0.02)], hi = sorted[Math.floor(count * 0.98)];
    for (let i = 0; i < count; i++) colors[3 * i + c] = Math.min(1, Math.max(0, (proj[i] - lo) / (hi - lo || 1)));
  });
  return colors;
}

export function descriptorOf(desc, index) {
  return desc.subarray(index * DESCRIPTOR_DIM, (index + 1) * DESCRIPTOR_DIM);
}
