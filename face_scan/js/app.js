// Face Scan 3D — fluxo principal: câmera → guia estilo Face ID → reconstrução 3D → resultado.

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { MEDIAPIPE_WASM, FACE_MODEL_URL, CAMERA_IDEAL, FRAMING, TEXTURE_SIZE, NUM_LANDMARKS } from './config.js';
import { TRIANGLES, UVS } from './face_topology.js';
import { FrameAnalyzer, landmarkBox } from './quality.js';
import { PoseTracker, poseFromMatrix } from './pose.js';
import { ScanGuide, STEPS, STEP_LABELS, angleDiff, nearestSector } from './guidance.js';
import { Feedback } from './feedback.js';
import {
  toPixel3D, landmarkNormals, fuseViews, toMillimeters, loopSubdivide, faceMeasurements, poseFromLandmarks,
} from './reconstruct.js';
import { bakeTexture } from './texture.js';
import {
  computeDescriptors, descriptorColors, descriptorOf, DESCRIPTOR_DIM, GEOMETRY_DIM, VIEW_DIM, VIEW_SLOTS,
} from './descriptors.js';
import { landmarkName, regionOf } from './landmarks.js';
import { FaceViewer } from './viewer.js';
import * as exporter from './exporter.js';

const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const TICKS = 72;

const state = {
  landmarker: null,
  delegate: params.has('cpu') ? 'CPU' : 'GPU',
  stream: null,
  facingMode: 'user',
  mirrored: true,
  running: false,
  lastTs: 0,
  guide: new ScanGuide(),
  poseTracker: new PoseTracker(),
  feedback: new Feedback(),
  analyzer: null,
  keyframes: [],
  shownHint: null,
  pendingHint: null,
  tickState: [],
  scan: null,
  viewer: null,
  fps: 0,
  lastFrameAt: 0,
};
if (DEBUG) window.faceScan = state;

const video = $('#video');
const work = document.createElement('canvas');
const workCtx = work.getContext('2d', { willReadFrequently: true });
const overlay = $('#overlay');
const overlayCtx = overlay.getContext('2d');

// ---------------------------------------------------------------- telas

function showScreen(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('active', s.id === id);
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- IA

async function createLandmarker(delegate) {
  const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate },
    runningMode: 'VIDEO',
    numFaces: 2,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

async function ensureLandmarker() {
  if (state.landmarker) return;
  try {
    state.landmarker = await createLandmarker(state.delegate);
  } catch (err) {
    if (state.delegate === 'CPU') throw err;
    console.warn('GPU indisponível para o MediaPipe, usando CPU.', err);
    state.delegate = 'CPU';
    state.landmarker = await createLandmarker('CPU');
  }
}

// ---------------------------------------------------------------- câmera

function cameraErrorMessage(err) {
  if (!window.isSecureContext) {
    return 'A câmera só funciona em HTTPS ou em http://localhost. Veja o README (face_scan/README.md) para abrir no celular com HTTPS.';
  }
  switch (err?.name) {
    case 'NotAllowedError': return 'Permissão da câmera negada. Libere o acesso à câmera nas configurações do navegador e tente de novo.';
    case 'NotFoundError': return 'Nenhuma câmera encontrada neste aparelho.';
    case 'NotReadableError': return 'A câmera está sendo usada por outro aplicativo. Feche-o e tente novamente.';
    default: return `Não foi possível abrir a câmera (${err?.message || err}).`;
  }
}

async function startCamera() {
  stopCamera();
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia indisponível');
  state.stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: state.facingMode, width: { ideal: CAMERA_IDEAL.width }, height: { ideal: CAMERA_IDEAL.height } },
  });
  video.srcObject = state.stream;
  await video.play();
  state.mirrored = state.facingMode === 'user';
  $('#stage').classList.toggle('mirrored', state.mirrored);
}

function stopCamera() {
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null;
}

// ---------------------------------------------------------------- escaneamento

function buildTicks() {
  const g = $('#ticks');
  g.innerHTML = '';
  state.tickState = [];
  for (let j = 0; j < TICKS; j++) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    g.appendChild(line);
    state.tickState.push('');
  }
  layoutTicks();
}

// Os traços são posicionados na direção da tela para onde a cabeça precisa virar.
function layoutTicks() {
  const lines = $('#ticks').children;
  for (let j = 0; j < lines.length; j++) {
    const a = (j * 360 / TICKS) * Math.PI / 180;
    const sx = Math.cos(a) * (state.mirrored ? 1 : -1), sy = -Math.sin(a);
    lines[j].setAttribute('x1', (sx * 89).toFixed(2));
    lines[j].setAttribute('y1', (sy * 89).toFixed(2));
    lines[j].setAttribute('x2', (sx * 97).toFixed(2));
    lines[j].setAttribute('y2', (sy * 97).toFixed(2));
  }
}

function buildSteps() {
  $('#steps').innerHTML = STEPS.map((s) => `<li data-step="${s}">${STEP_LABELS[s]}</li>`).join('');
}

async function startScan() {
  $('#intro-error').hidden = true;
  state.feedback.voice = $('#opt-voice').checked;
  state.feedback.haptics = $('#opt-haptics').checked;
  state.feedback.unlock();
  showScreen('screen-scan');
  $('#loading').hidden = false;
  $('#loading-text').textContent = 'Carregando IA de mapeamento facial…';
  setHint({ key: 'boot', text: 'Preparando câmera…', tone: 'info' });

  try {
    await ensureLandmarker();
    $('#loading-text').textContent = 'Abrindo a câmera…';
    await startCamera();
  } catch (err) {
    console.error(err);
    stopScan();
    showScreen('screen-intro');
    const box = $('#intro-error');
    box.textContent = state.landmarker ? cameraErrorMessage(err) : `Falha ao carregar o modelo de IA: ${err.message || err}. Verifique a conexão com a internet.`;
    box.hidden = false;
    return;
  }

  state.analyzer ??= new FrameAnalyzer();
  state.guide.reset();
  state.poseTracker.reset();
  state.keyframes = [];
  state.shownHint = null;
  buildTicks();
  buildSteps();
  $('#loading').hidden = true;
  $('#hud').hidden = !DEBUG;
  state.running = true;
  state.feedback.say('start', 'Olhe para a câmera e posicione o rosto dentro do círculo', { force: true });
  scheduleFrame();
}

function stopScan() {
  state.running = false;
  stopCamera();
  $('#arrow').hidden = true;
}

function scheduleFrame() {
  if (!state.running) return;
  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) video.requestVideoFrameCallback(onFrame);
  else requestAnimationFrame(onFrame);
}

function onFrame() {
  if (!state.running) return;
  try {
    processFrame();
  } catch (err) {
    console.error(err);
    if (state.delegate === 'GPU') {
      // Alguns aparelhos falham no delegate de GPU só durante a inferência.
      state.running = false;
      state.landmarker?.close();
      state.landmarker = null;
      state.delegate = 'CPU';
      ensureLandmarker().then(() => { state.running = true; scheduleFrame(); });
      return;
    }
  }
  scheduleFrame();
}

// Transformação da imagem da câmera para o palco quadrado (object-fit: cover + espelho).
function stageMapping(W, H) {
  const S = $('#stage').clientWidth;
  const scale = Math.max(S / W, S / H);
  return { S, scale, offX: (S - W * scale) / 2, offY: (S - H * scale) / 2 };
}

function toStage(m, x, y) {
  let sx = x * m.scale + m.offX;
  if (state.mirrored) sx = m.S - sx;
  return [sx, y * m.scale + m.offY];
}

function eyesOpen(result) {
  const cats = result.faceBlendshapes?.[0]?.categories;
  if (!cats) return undefined;
  const score = (name) => cats.find((c) => c.categoryName === name)?.score ?? 0;
  return score('eyeBlinkLeft') < 0.55 && score('eyeBlinkRight') < 0.55;
}

function processFrame() {
  const W = video.videoWidth, H = video.videoHeight;
  if (!W || !H) return;
  if (work.width !== W || work.height !== H) { work.width = W; work.height = H; }
  workCtx.drawImage(video, 0, 0, W, H);
  const now = performance.now();
  const ts = Math.max(now, state.lastTs + 1);
  state.lastTs = ts;
  const result = state.landmarker.detectForVideo(work, ts);

  const dt = now - state.lastFrameAt;
  state.lastFrameAt = now;
  if (dt > 0 && dt < 1000) state.fps += 0.1 * (1000 / dt - state.fps);

  const faces = result.faceLandmarks || [];
  const m = stageMapping(W, H);
  const obs = { faceCount: faces.length };
  let landmarks = null;
  if (faces.length) {
    landmarks = faces[0];
    const matrix = result.facialTransformationMatrixes?.[0];
    const raw = matrix ? poseFromMatrix(matrix.data) : poseFromLandmarks(toPixel3D(landmarks, W, H));
    obs.pose = state.poseTracker.update(raw, now);
    obs.speed = state.poseTracker.speed;
    const box = landmarkBox(landmarks, W, H);
    const [cx, cy] = toStage(m, (box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2);
    obs.offset = { x: (cx - m.S / 2) / m.S, y: (cy - m.S / 2) / m.S };
    obs.faceWidth = ((box.x1 - box.x0) * m.scale) / (2 * FRAMING.guideRadius * m.S);
    const q = state.analyzer.analyze(work, box);
    obs.brightness = q.brightness;
    obs.sharpness = q.sharpness;
    obs.eyesOpen = eyesOpen(result);
  } else {
    state.poseTracker.reset();
  }

  const step = state.guide.update(obs, now);
  if (step.capture) captureKeyframe(step.capture, landmarks, obs.pose, W, H);

  drawOverlay(landmarks, m, W, H, step);
  updateRing(step);
  updateHint(step.hint, now);
  updateSteps();
  if (DEBUG) updateHud(obs, step);

  if (state.guide.phase === 'done') finishScan();
}

function captureKeyframe(name, landmarks, pose, W, H) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  canvas.getContext('2d').drawImage(work, 0, 0);
  state.keyframes.push({
    name,
    canvas,
    width: W,
    height: H,
    landmarks: landmarks.map((p) => ({ x: p.x, y: p.y, z: p.z })),
    pose: { ...pose },
  });
  state.feedback.captured();
  const flash = $('#flash');
  flash.classList.remove('on');
  void flash.offsetWidth;
  flash.classList.add('on');
}

function drawOverlay(landmarks, m, W, H, step) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const size = Math.round(m.S * dpr);
  if (overlay.width !== size) { overlay.width = size; overlay.height = size; }
  overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  overlayCtx.clearRect(0, 0, m.S, m.S);
  if (!landmarks) return;
  const holding = step.holdProgress > 0;
  overlayCtx.fillStyle = holding ? 'rgba(52, 211, 153, 0.95)' : 'rgba(94, 234, 212, 0.85)';
  const r = Math.max(0.9, m.S / 420);
  for (let i = 0; i < landmarks.length; i++) {
    const [x, y] = toStage(m, landmarks[i].x * W, landmarks[i].y * H);
    overlayCtx.beginPath();
    overlayCtx.arc(x, y, i >= 468 ? r * 1.4 : r, 0, Math.PI * 2);
    overlayCtx.fill();
  }
}

function tickClass(j, step) {
  const angle = j * 360 / TICKS;
  const sector = nearestSector(angle).id;
  const guide = state.guide;
  if (guide.phase === 'align') {
    return j < step.holdProgress * TICKS ? 'active' : '';
  }
  if (guide.isDone(sector)) return 'done';
  const head = step.head;
  if (head && head.r > 0.35 && angleDiff(angle, head.angle) < 14) return 'active';
  if (sector === guide.target) return 'target';
  return '';
}

function updateRing(step) {
  const lines = $('#ticks').children;
  for (let j = 0; j < lines.length; j++) {
    const cls = tickClass(j, step);
    if (state.tickState[j] !== cls) {
      state.tickState[j] = cls;
      lines[j].setAttribute('class', cls);
    }
  }
}

function screenDir(hint) {
  if (!hint?.dir) return null;
  if (hint.space === 'screen') return hint.dir;
  return { x: state.mirrored ? hint.dir.x : -hint.dir.x, y: -hint.dir.y };
}

function setHint(hint) {
  const el = $('#hint');
  el.textContent = hint.text;
  el.className = `hint ${hint.tone || ''}`;
}

function updateHint(hint, now) {
  if (!hint) return;
  // Pequeno atraso evita que a dica "pisque" entre dois estados.
  if (!state.pendingHint || state.pendingHint.key !== hint.key) state.pendingHint = { key: hint.key, since: now };
  const stable = now - state.pendingHint.since > 350 || hint.tone === 'good';
  if (stable && state.shownHint?.key !== hint.key) {
    state.shownHint = hint;
    setHint(hint);
    const speakable = !hint.key.startsWith('hold') && !hint.key.startsWith('captured');
    if (speakable) state.feedback.say(hint.key, hint.text);
  } else if (stable) {
    state.shownHint = hint;
  }

  const dir = screenDir(state.shownHint);
  const arrow = $('#arrow');
  if (dir) {
    const S = $('#stage').clientWidth;
    const angle = Math.atan2(dir.y, dir.x);
    const x = S / 2 + Math.cos(angle) * S * 0.36, y = S / 2 + Math.sin(angle) * S * 0.36;
    arrow.style.transform = `translate(${x}px, ${y}px) rotate(${angle}rad)`;
    arrow.hidden = false;
    state.feedback.nudge(dir);
  } else {
    arrow.hidden = true;
  }
}

function updateSteps() {
  const guide = state.guide;
  for (const li of $('#steps').children) {
    const s = li.dataset.step;
    li.className = guide.isDone(s) ? 'done' : s === guide.target ? 'current' : '';
  }
  $('#scan-counter').textContent = `${guide.captured.size}/${STEPS.length}`;
  $('#btn-finish').hidden = !(guide.canFinish && guide.phase !== 'done');
}

function updateHud(obs, step) {
  const f = (x, d = 1) => (x == null ? '—' : x.toFixed(d));
  $('#hud').textContent = [
    `fps ${f(state.fps)}  delegate ${state.delegate}  faces ${obs.faceCount}`,
    obs.pose ? `yaw ${f(obs.pose.yaw)}  pitch ${f(obs.pose.pitch)}  roll ${f(obs.pose.roll)}  vel ${f(obs.speed, 0)}°/s` : '',
    step.head ? `u ${f(step.head.u, 2)}  v ${f(step.head.v, 2)}  r ${f(step.head.r, 2)}  θ ${f(step.head.angle, 0)}` : '',
    obs.faceWidth != null ? `largura ${f(obs.faceWidth, 2)}  centro ${f(obs.offset.x, 2)},${f(obs.offset.y, 2)}` : '',
    obs.brightness != null ? `brilho ${f(obs.brightness, 0)}  nitidez ${f(obs.sharpness, 0)}  olhos ${obs.eyesOpen}` : '',
    `fase ${state.guide.phase}  alvo ${state.guide.target}  dica ${step.hint?.key}`,
  ].filter(Boolean).join('\n');
}

function finishScan() {
  if (!state.running) return;
  stopScan();
  state.feedback.complete();
  state.feedback.say('done', 'Mapeamento completo. Gerando seu rosto em 3D.', { force: true });
  processScan().catch((err) => {
    console.error(err);
    showScreen('screen-intro');
    const box = $('#intro-error');
    box.textContent = `Falha ao processar o escaneamento: ${err.message || err}`;
    box.hidden = false;
  });
}

// ---------------------------------------------------------------- processamento

const nextFrame = () => new Promise((r) => setTimeout(r, 30));

function procStep(name, progress) {
  for (const li of document.querySelectorAll('#proc-steps li')) {
    const order = ['fusion', 'texture', 'mesh', 'descriptors'];
    const i = order.indexOf(li.dataset.step), cur = order.indexOf(name);
    li.className = i < cur ? 'done' : i === cur ? 'active' : '';
  }
  $('#proc-bar').style.width = `${Math.round(progress * 100)}%`;
}

async function processScan() {
  showScreen('screen-processing');
  procStep('fusion', 0.05);
  await nextFrame();

  const views = state.keyframes.map((kf) => {
    const P = toPixel3D(kf.landmarks, kf.width, kf.height);
    return {
      name: kf.name,
      width: kf.width,
      height: kf.height,
      pose: kf.pose,
      landmarks: kf.landmarks,
      canvas: kf.canvas,
      P,
      N: landmarkNormals(P),
      image: kf.canvas.getContext('2d').getImageData(0, 0, kf.width, kf.height),
    };
  });

  const fusion = fuseViews(views);
  const mm = toMillimeters(fusion.points);
  const normals = landmarkNormals(mm.points);
  procStep('texture', 0.25);
  await nextFrame();

  const tex = bakeTexture(views, TEXTURE_SIZE, fusion.frontIndex);
  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = textureCanvas.height = tex.size;
  textureCanvas.getContext('2d').putImageData(new ImageData(tex.data, tex.size, tex.size), 0, 0);
  procStep('mesh', 0.45);
  await nextFrame();

  const mesh = loopSubdivide(mm.points.subarray(0, 468 * 3), UVS, TRIANGLES);
  procStep('descriptors', 0.5);
  await nextFrame();

  const descriptors = await computeDescriptors({
    fused: mm.points,
    normals,
    views,
    onProgress: (p) => { $('#proc-bar').style.width = `${Math.round((0.5 + 0.45 * p) * 100)}%`; },
  });
  const colors = descriptorColors(descriptors);
  $('#proc-bar').style.width = '100%';

  state.scan = {
    createdAt: new Date().toISOString(),
    views,
    pointsMm: mm.points,
    normals,
    mmPerUnit: mm.mmPerUnit,
    residualsMm: fusion.residuals.map((r) => r * mm.mmPerUnit),
    mesh,
    textureCanvas,
    coverage: tex.coverage,
    descriptors,
    colors,
    measurements: faceMeasurements(mm.points),
  };
  await nextFrame();
  showResult();
}

// ---------------------------------------------------------------- resultado

const nf = (x, d = 0) => x.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

function renderStats(scan) {
  const avgResidual = scan.residualsMm.reduce((a, b) => a + b, 0) / scan.residualsMm.length;
  const m = scan.measurements;
  $('#stats').innerHTML = `
    <div class="stat"><b>${nf(NUM_LANDMARKS)}</b><span>pontos 3D mapeados</span></div>
    <div class="stat"><b>${nf(DESCRIPTOR_DIM)}</b><span>dimensões por ponto</span></div>
    <div class="stat"><b>${nf(NUM_LANDMARKS * DESCRIPTOR_DIM)}</b><span>valores no template</span></div>
    <div class="stat"><b>${scan.views.length}</b><span>vistas fundidas</span></div>
    <div class="stat"><b>${nf(scan.mesh.triangles.length / 3)}</b><span>triângulos na malha</span></div>
    <div class="stat"><b>${nf(avgResidual, 2)} mm</b><span>erro médio de fusão</span></div>
    <div class="stat full">
      <dl class="measure">
        <dt>Largura do rosto</dt><dd>≈ ${nf(m.faceWidth)} mm</dd>
        <dt>Altura (testa–queixo)</dt><dd>≈ ${nf(m.faceHeight)} mm</dd>
        <dt>Comprimento do nariz</dt><dd>≈ ${nf(m.noseLength)} mm</dd>
        <dt>Projeção do nariz</dt><dd>≈ ${nf(m.noseDepth)} mm</dd>
        <dt>Largura da boca</dt><dd>≈ ${nf(m.mouthWidth)} mm</dd>
      </dl>
      <span>Escala estimada assumindo distância interpupilar de 63 mm.</span>
    </div>`;
}

function renderThumbs(scan) {
  const box = $('#thumbs');
  box.innerHTML = '';
  for (const v of scan.views) {
    const wrap = document.createElement('div');
    wrap.className = 'thumb';
    const c = document.createElement('canvas');
    // Recorte do rosto na foto, com os pontos detectados por cima.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of v.landmarks) {
      x0 = Math.min(x0, p.x * v.width); x1 = Math.max(x1, p.x * v.width);
      y0 = Math.min(y0, p.y * v.height); y1 = Math.max(y1, p.y * v.height);
    }
    const h = (y1 - y0) * 1.35, w = h * 0.75;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    c.width = 150; c.height = 200;
    const g = c.getContext('2d');
    const s = 150 / w;
    g.save();
    if (state.mirrored) { g.translate(150, 0); g.scale(-1, 1); }
    g.drawImage(v.canvas, cx - w / 2, cy - h / 2, w, h, 0, 0, 150, 200);
    g.fillStyle = 'rgba(94, 234, 212, 0.9)';
    for (const p of v.landmarks) {
      g.fillRect((p.x * v.width - (cx - w / 2)) * s - 0.6, (p.y * v.height - (cy - h / 2)) * s - 0.6, 1.2, 1.2);
    }
    g.restore();
    wrap.appendChild(c);
    wrap.append(STEP_LABELS[v.name] || v.name);
    box.appendChild(wrap);
  }
}

function diverging(t) {
  // -1 → azul, 0 → quase preto, +1 → âmbar
  const a = Math.min(1, Math.abs(t));
  return t < 0 ? [20 + 30 * a, 40 + 120 * a, 60 + 195 * a] : [20 + 235 * a, 40 + 150 * a, 60 - 40 * a];
}

function renderInspector(index) {
  const scan = state.scan;
  state.viewer.selectPoint(index);
  $('#insp-empty').hidden = true;
  $('#insp-body').hidden = false;
  $('#insp-name').textContent = landmarkName(index);
  $('#insp-index').textContent = `#${index} · ${regionOf(index)}`;
  const p = scan.pointsMm;
  $('#insp-pos').textContent = `x ${nf(p[3 * index], 1)}  y ${nf(p[3 * index + 1], 1)}  z ${nf(p[3 * index + 2], 1)} mm · vetor com ${nf(DESCRIPTOR_DIM)} valores`;

  const d = descriptorOf(scan.descriptors, index);
  const strip = $('#insp-strip');
  const g = strip.getContext('2d');
  const img = g.createImageData(DESCRIPTOR_DIM, strip.height);
  const blocks = [[0, GEOMETRY_DIM], ...VIEW_SLOTS.map((_, s) => [GEOMETRY_DIM + s * VIEW_DIM, GEOMETRY_DIM + (s + 1) * VIEW_DIM])];
  for (const [a, b] of blocks) {
    let maxAbs = 1e-9;
    for (let i = a; i < b; i++) maxAbs = Math.max(maxAbs, Math.abs(d[i]));
    for (let i = a; i < b; i++) {
      const [r, gg, bb] = diverging(d[i] / maxAbs);
      for (let y = 0; y < strip.height; y++) {
        const k = 4 * (y * DESCRIPTOR_DIM + i);
        img.data[k] = r; img.data[k + 1] = gg; img.data[k + 2] = bb; img.data[k + 3] = 255;
      }
    }
  }
  g.putImageData(img, 0, 0);
  const shortNames = { front: 'Frente', left: 'Esq', right: 'Dir', up: 'Cima', down: 'Baixo', up_left: '↖', up_right: '↗', down_left: '↙', down_right: '↘' };
  $('#insp-legend').innerHTML = [`<span style="flex:${GEOMETRY_DIM}">Geo</span>`,
    ...VIEW_SLOTS.map((s) => `<span style="flex:${VIEW_DIM}">${shortNames[s]}</span>`)].join('');

  // Como o ponto aparece em cada foto (o recorte que gerou cada bloco do vetor).
  const patches = $('#insp-patches');
  patches.innerHTML = '';
  for (const [s, slot] of VIEW_SLOTS.entries()) {
    const view = scan.views.find((v) => v.name === slot);
    if (!view) continue;
    const vis = d[GEOMETRY_DIM + s * VIEW_DIM];
    const cell = document.createElement('div');
    cell.className = `patch${vis > 0 ? '' : ' hidden-view'}`;
    const c = document.createElement('canvas');
    c.width = c.height = 72;
    const ctx = c.getContext('2d');
    const x = view.P[3 * index], y = -view.P[3 * index + 1];
    const ex = view.P[3 * 263] - view.P[3 * 33], ey = -(view.P[3 * 263 + 1] - view.P[3 * 33 + 1]);
    const iod = Math.hypot(ex, ey, view.P[3 * 263 + 2] - view.P[3 * 33 + 2]);
    const radius = 0.24 * iod;
    ctx.translate(36, 36);
    ctx.scale(36 / radius, 36 / radius);
    ctx.rotate(-Math.atan2(ey, ex));
    ctx.translate(-x, -y);
    ctx.drawImage(view.canvas, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(18, 18, 36, 36);
    cell.appendChild(c);
    cell.append(`${shortNames[slot]} · ${vis > 0 ? `${Math.round(vis * 100)}%` : 'oculto'}`);
    patches.appendChild(cell);
  }
}

async function setupBackend() {
  const card = $('#backend-card');
  card.hidden = true;
  if (!(await exporter.backendAvailable())) return;
  try {
    const students = await exporter.listStudents();
    const select = $('#student-select');
    select.innerHTML = students.length
      ? students.map((s) => `<option value="${s.id}">${s.id} — ${String(s.name).replace(/[<>&]/g, '')}</option>`).join('')
      : '<option value="">Nenhum aluno cadastrado</option>';
    $('#btn-save').disabled = !students.length;
    card.hidden = false;
  } catch (err) {
    console.warn('Backend indisponível', err);
  }
}

function showResult() {
  const scan = state.scan;
  showScreen('screen-result');
  if (!state.viewer) {
    state.viewer = new FaceViewer($('#viewer'));
    state.viewer.onPick = renderInspector;
  }
  state.viewer.setFace({ mesh: scan.mesh, textureCanvas: scan.textureCanvas, points: scan.pointsMm, pointColors: scan.colors });
  state.viewer.setMode('texture');
  for (const b of document.querySelectorAll('.mode')) b.classList.toggle('active', b.dataset.mode === 'texture');
  state.viewer.selectPoint(null);
  $('#insp-empty').hidden = false;
  $('#insp-body').hidden = true;
  renderStats(scan);
  renderThumbs(scan);
  $('#save-status').textContent = '';
  setupBackend();
}

// ---------------------------------------------------------------- eventos

$('#btn-start').addEventListener('click', startScan);
$('#btn-cancel').addEventListener('click', () => { stopScan(); showScreen('screen-intro'); });
$('#btn-finish').addEventListener('click', () => { if (state.guide.finishEarly()) finishScan(); });
$('#btn-flip').addEventListener('click', async () => {
  state.facingMode = state.facingMode === 'user' ? 'environment' : 'user';
  try {
    await startCamera();
    layoutTicks();
    state.poseTracker.reset();
  } catch (err) {
    setHint({ text: cameraErrorMessage(err), tone: 'warn' });
  }
});
$('#btn-restart').addEventListener('click', () => { showScreen('screen-intro'); });

for (const btn of document.querySelectorAll('.mode')) {
  btn.addEventListener('click', () => {
    for (const b of document.querySelectorAll('.mode')) b.classList.toggle('active', b === btn);
    state.viewer?.setMode(btn.dataset.mode);
  });
}

$('#btn-glb').addEventListener('click', async () => {
  const blob = await state.viewer.exportGLB();
  exporter.downloadBlob(blob, exporter.timestampName('rosto_3d', 'glb'));
});
$('#btn-json').addEventListener('click', () => {
  const json = JSON.stringify(exporter.buildTemplate(state.scan));
  exporter.downloadBlob(new Blob([json], { type: 'application/json' }), exporter.timestampName('rosto_template', 'json'));
});
$('#btn-png').addEventListener('click', async () => {
  const blob = await (await fetch(state.viewer.snapshot())).blob();
  exporter.downloadBlob(blob, exporter.timestampName('rosto_3d', 'png'));
});
$('#btn-save').addEventListener('click', async () => {
  const status = $('#save-status');
  const id = Number($('#student-select').value);
  if (!id) return;
  status.className = 'muted';
  status.textContent = 'Enviando…';
  $('#btn-save').disabled = true;
  try {
    const res = await exporter.saveToBackend(state.scan, id, $('#opt-replace').checked);
    status.className = 'ok';
    status.textContent = `Rosto salvo (cadastro #${res.face.id}) para o aluno ${id}.`;
  } catch (err) {
    status.className = 'err';
    status.textContent = err.message;
  } finally {
    $('#btn-save').disabled = false;
  }
});

window.addEventListener('resize', () => { if (state.running) layoutTicks(); });
