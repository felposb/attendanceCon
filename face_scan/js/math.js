// Álgebra linear mínima usada na reconstrução 3D (sem dependências externas).

// Autovalores/autovetores de uma matriz simétrica n×n pelo método de Jacobi.
// Retorna { values, vectors } onde vectors[k][j] é a componente k do autovetor j.
export function jacobiEigen(matrix) {
  const n = matrix.length;
  const a = matrix.map((row) => row.slice());
  const v = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p], vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { values: a.map((row, i) => row[i]), vectors: v };
}

// Alinhamento de similaridade ponderado (escala + rotação + translação) que leva `src` a `dst`.
// Método de Horn com quatérnios. src/dst: arrays planos [x0,y0,z0,x1,...]; w: peso por ponto.
export function similarityAlign(src, dst, w) {
  const n = w.length;
  let sw = 0;
  const ma = [0, 0, 0], mb = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const wi = w[i];
    if (!(wi > 0)) continue;
    sw += wi;
    for (let d = 0; d < 3; d++) {
      ma[d] += wi * src[3 * i + d];
      mb[d] += wi * dst[3 * i + d];
    }
  }
  if (sw <= 0) return { s: 1, R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };
  for (let d = 0; d < 3; d++) { ma[d] /= sw; mb[d] /= sw; }

  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let saa = 0;
  for (let i = 0; i < n; i++) {
    const wi = w[i];
    if (!(wi > 0)) continue;
    const a0 = src[3 * i] - ma[0], a1 = src[3 * i + 1] - ma[1], a2 = src[3 * i + 2] - ma[2];
    const b0 = dst[3 * i] - mb[0], b1 = dst[3 * i + 1] - mb[1], b2 = dst[3 * i + 2] - mb[2];
    const a = [a0, a1, a2], b = [b0, b1, b2];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r][c] += wi * a[r] * b[c];
    saa += wi * (a0 * a0 + a1 * a1 + a2 * a2);
  }
  const [[Sxx, Sxy, Sxz], [Syx, Syy, Syz], [Szx, Szy, Szz]] = S;
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
  ];
  const { values, vectors } = jacobiEigen(N);
  let best = 0;
  for (let j = 1; j < 4; j++) if (values[j] > values[best]) best = j;
  const qw = vectors[0][best], qx = vectors[1][best], qy = vectors[2][best], qz = vectors[3][best];
  const R = [
    1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qw * qz), 2 * (qx * qz + qw * qy),
    2 * (qx * qy + qw * qz), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qw * qx),
    2 * (qx * qz - qw * qy), 2 * (qy * qz + qw * qx), 1 - 2 * (qx * qx + qy * qy),
  ];
  let num = 0;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) num += R[3 * r + c] * S[c][r];
  const s = saa > 0 ? num / saa : 1;
  const t = [0, 0, 0];
  for (let r = 0; r < 3; r++) {
    t[r] = mb[r] - s * (R[3 * r] * ma[0] + R[3 * r + 1] * ma[1] + R[3 * r + 2] * ma[2]);
  }
  return { s, R, t };
}

export function applySimilarity(points, { s, R, t }) {
  const out = new Float64Array(points.length);
  for (let i = 0; i < points.length; i += 3) {
    const x = points[i], y = points[i + 1], z = points[i + 2];
    out[i] = s * (R[0] * x + R[1] * y + R[2] * z) + t[0];
    out[i + 1] = s * (R[3] * x + R[4] * y + R[5] * z) + t[1];
    out[i + 2] = s * (R[6] * x + R[7] * y + R[8] * z) + t[2];
  }
  return out;
}

export function rotate(R, x, y, z) {
  return [R[0] * x + R[1] * y + R[2] * z, R[3] * x + R[4] * y + R[5] * z, R[6] * x + R[7] * y + R[8] * z];
}

export function dist3(P, i, j) {
  const dx = P[3 * i] - P[3 * j], dy = P[3 * i + 1] - P[3 * j + 1], dz = P[3 * i + 2] - P[3 * j + 2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Gerador pseudoaleatório determinístico (mulberry32).
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussianRandom(rand) {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}
