// Testes das partes puras do Face Scan 3D. Rodar com: node --test face_scan/tests
import test from 'node:test';
import assert from 'node:assert/strict';

import { similarityAlign, applySimilarity, jacobiEigen } from '../js/math.js';
import { fuseViews, landmarkNormals, loopSubdivide, poseFromLandmarks, toMillimeters } from '../js/reconstruct.js';
import { TRIANGLES, UVS } from '../js/face_topology.js';
import { ScanGuide, STEPS } from '../js/guidance.js';
import { computeDescriptors, DESCRIPTOR_DIM, VIEW_DIM, GEOMETRY_DIM, VIEW_SLOTS } from '../js/descriptors.js';

// Rosto sintético: a própria malha UV "inflada" em uma cúpula, na escala de pixels.
function syntheticFace() {
  const P = new Float64Array(478 * 3);
  for (let i = 0; i < 468; i++) {
    const x = (UVS[2 * i] - 0.5) * 300, y = (UVS[2 * i + 1] - 0.5) * 380;
    P[3 * i] = x;
    P[3 * i + 1] = y;
    P[3 * i + 2] = 110 * Math.max(0, 1 - (x / 190) ** 2 - (y / 240) ** 2);
  }
  const irisFrom = [468, 33, 469, 133, 470, 159, 471, 145, 472, 33, 473, 263, 474, 362, 475, 386, 476, 374, 477, 263];
  for (let k = 0; k < irisFrom.length; k += 2) {
    for (let d = 0; d < 3; d++) P[3 * irisFrom[k] + d] = P[3 * irisFrom[k + 1] + d];
  }
  // Centros da íris no meio dos olhos.
  for (const [c, a, b] of [[468, 33, 133], [473, 263, 362]]) {
    for (let d = 0; d < 3; d++) P[3 * c + d] = (P[3 * a + d] + P[3 * b + d]) / 2;
  }
  return P;
}

function rotation(yawDeg, pitchDeg) {
  const a = (yawDeg * Math.PI) / 180, b = (pitchDeg * Math.PI) / 180;
  // Yaw positivo = pessoa vira para a direita dela (nariz vai para -x da câmera).
  const Ry = [Math.cos(a), 0, -Math.sin(a), 0, 1, 0, Math.sin(a), 0, Math.cos(a)];
  const Rx = [1, 0, 0, 0, Math.cos(b), Math.sin(b), 0, -Math.sin(b), Math.cos(b)];
  const m = (A, B) => Array.from({ length: 9 }, (_, k) => {
    const r = Math.floor(k / 3), c = k % 3;
    return A[3 * r] * B[c] + A[3 * r + 1] * B[3 + c] + A[3 * r + 2] * B[6 + c];
  });
  return m(Rx, Ry);
}

function rmsAfterAlign(A, B) {
  const w = new Float64Array(478).fill(1);
  const X = applySimilarity(A, similarityAlign(A, B, w));
  let s = 0;
  for (let i = 0; i < X.length; i++) s += (X[i] - B[i]) ** 2;
  return Math.sqrt(s / 478);
}

test('jacobiEigen decompõe matriz simétrica', () => {
  const { values } = jacobiEigen([[4, 1, 0], [1, 3, 1], [0, 1, 2]]);
  const sorted = values.sort((a, b) => a - b);
  assert.ok(Math.abs(sorted.reduce((a, b) => a + b) - 9) < 1e-9);
  assert.ok(Math.abs(sorted[0] * sorted[1] * sorted[2] - 18) < 1e-6); // det
});

test('similarityAlign recupera escala, rotação e translação', () => {
  const P = syntheticFace();
  const R = rotation(33, -12);
  const T = { s: 1.7, R, t: [40, -25, 12] };
  const Q = applySimilarity(P, T);
  const w = new Float64Array(478).fill(1);
  const est = similarityAlign(P, Q, w);
  assert.ok(Math.abs(est.s - 1.7) < 1e-6);
  for (let k = 0; k < 9; k++) assert.ok(Math.abs(est.R[k] - R[k]) < 1e-6);
  assert.ok(rmsAfterAlign(P, Q) < 1e-6);
});

test('normais apontam para a câmera (+z) na vista frontal', () => {
  const N = landmarkNormals(syntheticFace());
  assert.ok(N[3 * 1 + 2] > 0.8, 'nariz');
  let positive = 0;
  for (let i = 0; i < 468; i++) if (N[3 * i + 2] > 0) positive++;
  assert.ok(positive > 440);
});

test('poseFromLandmarks segue a convenção do app', () => {
  const P = syntheticFace();
  const right = poseFromLandmarks(applySimilarity(P, { s: 1, R: rotation(30, 0), t: [0, 0, 0] }));
  assert.ok(Math.abs(right.yaw - 30) < 1.5, `yaw ${right.yaw}`);
  const up = poseFromLandmarks(applySimilarity(P, { s: 1, R: rotation(0, 20), t: [0, 0, 0] }));
  assert.ok(up.pitch > 15, `pitch ${up.pitch}`);
});

test('fusão de várias vistas reduz o ruído em relação a uma única foto', () => {
  const truth = syntheticFace();
  let seed = 7;
  const noise = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 6; };
  const poses = [['front', 0, 0], ['left', -35, 0], ['right', 35, 0], ['up', 0, 20], ['down', 0, -16], ['up_left', -25, 14]];
  const views = poses.map(([name, yaw, pitch], k) => {
    const P = applySimilarity(truth, { s: 0.85 + 0.06 * k, R: rotation(yaw, pitch), t: [640, -360, 0] });
    for (let i = 0; i < P.length; i++) P[i] += noise();
    return { name, P, N: landmarkNormals(P) };
  });
  const fused = fuseViews(views);
  const errFront = rmsAfterAlign(views[0].P, truth);
  const errFused = rmsAfterAlign(fused.points, truth);
  assert.ok(errFused < errFront * 0.8, `fundido ${errFused.toFixed(3)} vs frontal ${errFront.toFixed(3)}`);
  assert.equal(fused.residuals.length, views.length);
});

test('conversão para milímetros usa a distância interpupilar', () => {
  const { points } = toMillimeters(syntheticFace());
  const d = Math.hypot(points[3 * 468] - points[3 * 473], points[3 * 468 + 1] - points[3 * 473 + 1], points[3 * 468 + 2] - points[3 * 473 + 2]);
  assert.ok(Math.abs(d - 63) < 1e-3);
});

test('subdivisão de Loop quadruplica os triângulos', () => {
  const out = loopSubdivide(syntheticFace().subarray(0, 468 * 3), UVS, TRIANGLES);
  assert.equal(out.triangles.length, TRIANGLES.length * 4);
  assert.equal(out.positions.length / 3, 468 + 1365);
  assert.equal(out.uvs.length / 2, 468 + 1365);
});

test('descritor tem 2362 dimensões e zera vistas ausentes', async () => {
  assert.equal(DESCRIPTOR_DIM, 40 + 9 * 258);
  const P = applySimilarity(syntheticFace(), { s: 1, R: rotation(0, 0), t: [640, -360, 0] });
  const W = 1280, H = 720;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const x = i % W, y = (i / W) | 0;
    const v = 128 + 100 * Math.sin(x / 7) * Math.cos(y / 5);
    data[4 * i] = v; data[4 * i + 1] = v * 0.8; data[4 * i + 2] = v * 0.6; data[4 * i + 3] = 255;
  }
  const views = [{ name: 'front', P, N: landmarkNormals(P), image: { data, width: W, height: H }, width: W, height: H }];
  const desc = await computeDescriptors({ fused: P, normals: landmarkNormals(P), views });
  assert.equal(desc.length, 478 * DESCRIPTOR_DIM);
  const nose = desc.subarray(DESCRIPTOR_DIM, 2 * DESCRIPTOR_DIM);
  assert.ok(nose[GEOMETRY_DIM] > 0.5, 'visibilidade frontal');
  const hist = nose.subarray(GEOMETRY_DIM + 1, GEOMETRY_DIM + 129);
  assert.ok(Math.abs(Math.hypot(...hist) - 1) < 1e-3, 'histograma normalizado');
  const leftSlot = VIEW_SLOTS.indexOf('left');
  const left = nose.subarray(GEOMETRY_DIM + leftSlot * VIEW_DIM, GEOMETRY_DIM + (leftSlot + 1) * VIEW_DIM);
  assert.ok(left.every((x) => x === 0), 'vista ausente fica zerada');
  assert.ok(desc.every(Number.isFinite));
});

test('guia conduz frente → perfis → círculo e captura cada vista uma vez', () => {
  const guide = new ScanGuide();
  const base = { faceCount: 1, speed: 5, faceWidth: 0.6, offset: { x: 0, y: 0 }, brightness: 120, sharpness: 50, eyesOpen: true };
  let t = 0;
  const run = (pose, ms) => {
    const caps = [];
    for (let k = 0; k < ms; k += 33) {
      t += 33;
      const r = guide.update({ ...base, pose: { roll: 0, ...pose } }, t);
      if (r.capture) caps.push(r.capture);
    }
    return caps;
  };
  assert.deepEqual(run({ yaw: 25, pitch: 0 }, 1000), [], 'não captura a frente com o rosto virado');
  assert.deepEqual(run({ yaw: 1, pitch: 2 }, 1000), ['front']);
  assert.equal(guide.update({ ...base, pose: { yaw: 0, pitch: 0, roll: 0 } }, t).hint.key, 'target-left');
  assert.deepEqual(run({ yaw: -38, pitch: 2 }, 500), ['left']);
  assert.deepEqual(run({ yaw: 38, pitch: 0 }, 500), ['right']);
  assert.ok(guide.canFinish);
  assert.deepEqual(run({ yaw: 0, pitch: 24 }, 500), ['up']);
  assert.deepEqual(run({ yaw: 0, pitch: -20 }, 500), ['down']);
  assert.deepEqual(run({ yaw: -30, pitch: 16 }, 500), ['up_left']);
  assert.deepEqual(run({ yaw: 30, pitch: 16 }, 500), ['up_right']);
  assert.deepEqual(run({ yaw: -30, pitch: -14 }, 500), ['down_left']);
  assert.deepEqual(run({ yaw: 30, pitch: -14 }, 500), ['down_right']);
  assert.equal(guide.phase, 'done');
  assert.equal(guide.captured.size, STEPS.length);
});

test('guia pede para voltar quando a cabeça vira demais ou some', () => {
  const guide = new ScanGuide();
  guide.capture('front', { yaw: 0, pitch: 0, roll: 0 });
  const base = { faceCount: 1, speed: 5, faceWidth: 0.6, offset: { x: 0, y: 0 }, brightness: 120, sharpness: 50 };
  assert.equal(guide.update({ ...base, pose: { yaw: -75, pitch: 0, roll: 0 } }, 100).hint.key, 'too-far');
  assert.equal(guide.update({ faceCount: 0 }, 200).hint.key, 'lost-far');
  assert.equal(guide.update({ ...base, brightness: 20, pose: { yaw: 0, pitch: 0, roll: 0 } }, 300).hint.key, 'dark');
  assert.equal(guide.update({ ...base, faceWidth: 0.2, pose: { yaw: 0, pitch: 0, roll: 0 } }, 400).hint.key, 'closer');
});

test('modo foto: avalia cada foto e orienta a próxima', async () => {
  const { evaluatePhoto } = await import('../js/guidance.js');
  const captured = new Set();
  const base = { faceCount: 1, faceWidthRatio: 0.4, inside: true, brightness: 120 };
  const ctx = { captured, baseline: { yaw: 0, pitch: 0 } };
  assert.equal(evaluatePhoto({ ...base, faceCount: 0 }, ctx).hint.key, 'no-face');
  assert.equal(evaluatePhoto({ ...base, pose: { yaw: 30, pitch: 0 } }, ctx).hint.key, 'look');
  let r = evaluatePhoto({ ...base, pose: { yaw: 2, pitch: 3 } }, ctx);
  assert.equal(r.step, 'front');
  captured.add('front');
  r = evaluatePhoto({ ...base, pose: { yaw: -12, pitch: 0 } }, ctx);
  assert.ok(!r.ok && r.hint.text.includes('esquerda'), r.hint.text);
  assert.ok(r.hint.dir.x < 0);
  r = evaluatePhoto({ ...base, pose: { yaw: 36, pitch: 2 } }, ctx);
  assert.equal(r.step, 'right', 'aceita outra pose que ainda falta (ex.: foto espelhada)');
  captured.add('right');
  assert.equal(evaluatePhoto({ ...base, pose: { yaw: 40, pitch: 0 } }, ctx).hint.key, 'repeat-right');
  assert.equal(evaluatePhoto({ ...base, pose: { yaw: -40, pitch: 0 } }, ctx).step, 'left');
  captured.add('left');
  r = evaluatePhoto({ ...base, pose: { yaw: 0, pitch: 8 } }, ctx);
  assert.ok(!r.ok && r.hint.text.includes('queixo'), r.hint.text);
  assert.equal(evaluatePhoto({ ...base, pose: { yaw: 0, pitch: 22 } }, ctx).step, 'up');
});
