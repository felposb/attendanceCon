// Máquina de estados que conduz o escaneamento, no estilo do cadastro do Face ID:
// primeiro o rosto de frente, depois os perfis e um círculo completo com a cabeça.
// Não acessa DOM: recebe observações de cada quadro e devolve a dica a mostrar/falar
// e quando capturar uma foto.

import { POSE_TARGETS, FRAMING, QUALITY } from './config.js';

export const SECTORS = [
  { id: 'left', angle: 180, label: 'Perfil esquerdo', hint: 'Vire o rosto devagar para a esquerda' },
  { id: 'right', angle: 0, label: 'Perfil direito', hint: 'Agora vire devagar para a direita' },
  { id: 'up', angle: 90, label: 'Para cima', hint: 'Levante o queixo e olhe para cima' },
  { id: 'down', angle: 270, label: 'Para baixo', hint: 'Abaixe o queixo e olhe para baixo' },
  { id: 'up_left', angle: 135, label: 'Cima e esquerda', hint: 'Gire a cabeça: para cima e para a esquerda' },
  { id: 'up_right', angle: 45, label: 'Cima e direita', hint: 'Continue o círculo: para cima e para a direita' },
  { id: 'down_left', angle: 225, label: 'Baixo e esquerda', hint: 'Continue o círculo: para baixo e para a esquerda' },
  { id: 'down_right', angle: 315, label: 'Baixo e direita', hint: 'Por último: para baixo e para a direita' },
];
export const STEPS = ['front', ...SECTORS.map((s) => s.id)];
export const REQUIRED_STEPS = ['front', 'left', 'right'];
export const STEP_LABELS = { front: 'Frente', ...Object.fromEntries(SECTORS.map((s) => [s.id, s.label])) };

const SECTOR_BY_ID = Object.fromEntries(SECTORS.map((s) => [s.id, s]));

export function angleDiff(a, b) {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180);
}

// Posição da cabeça em um plano normalizado: raio 1 = virou o suficiente naquela direção.
// Ângulo 0° = direita da pessoa, 90° = cima, 180° = esquerda, 270° = baixo.
export function headVector(pose, baseline = { yaw: 0, pitch: 0 }) {
  const yaw = pose.yaw - baseline.yaw;
  const pitch = pose.pitch - baseline.pitch;
  const u = yaw / POSE_TARGETS.yaw;
  const v = pitch / (pitch >= 0 ? POSE_TARGETS.pitchUp : POSE_TARGETS.pitchDown);
  let angle = (Math.atan2(v, u) * 180) / Math.PI;
  if (angle < 0) angle += 360;
  return { u, v, r: Math.hypot(u, v), angle, yaw, pitch };
}

export function nearestSector(angle) {
  let best = SECTORS[0];
  for (const s of SECTORS) if (angleDiff(angle, s.angle) < angleDiff(angle, best.angle)) best = s;
  return best;
}

function hint(key, text, tone = 'info', dir = null, space = 'user') {
  return { key, text, tone, dir, space };
}

function towards(fromU, fromV, toU, toV) {
  const x = toU - fromU, y = toV - fromV;
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
}

export class ScanGuide {
  constructor() {
    this.reset();
  }

  reset() {
    this.phase = 'align';
    this.captured = new Set();
    this.skipped = new Set();
    this.baseline = { yaw: 0, pitch: 0 };
    this.hold = null;
    this.lastSeen = 0;
    this.lastHead = null;
  }

  get target() {
    return STEPS.find((s) => !this.captured.has(s) && !this.skipped.has(s)) ?? null;
  }

  get canFinish() {
    return REQUIRED_STEPS.every((s) => this.captured.has(s));
  }

  isDone(step) {
    return this.captured.has(step);
  }

  // Encerra antes do círculo completo (só permitido depois de frente + dois perfis).
  finishEarly() {
    if (!this.canFinish) return false;
    for (const s of STEPS) if (!this.captured.has(s)) this.skipped.add(s);
    this.phase = 'done';
    return true;
  }

  holdFor(key, now, duration) {
    if (!this.hold || this.hold.key !== key) this.hold = { key, since: now };
    return Math.min(1, (now - this.hold.since) / duration);
  }

  capture(step, pose) {
    this.captured.add(step);
    this.hold = null;
    if (step === 'front') {
      const clamp = (x) => Math.max(-10, Math.min(10, x));
      this.baseline = { yaw: clamp(pose.yaw), pitch: clamp(pose.pitch) };
      this.phase = 'sweep';
    }
    if (!this.target) this.phase = 'done';
  }

  // obs: { faceCount, pose, speed, faceWidth (fração do diâmetro do círculo),
  //        offset: {x, y} (deslocamento do centro, fração do palco), brightness, sharpness, eyesOpen }
  update(obs, now) {
    const out = { hint: null, capture: null, head: null, holdProgress: 0 };
    if (this.phase === 'done') {
      out.hint = hint('done', 'Mapeamento completo!', 'good');
      return out;
    }

    if (!obs.faceCount) {
      this.hold = null;
      const h = this.lastHead;
      if (this.phase === 'sweep' && h && h.r > 1.2 && now - this.lastSeen < 4000) {
        out.hint = hint('lost-far', 'Você virou demais — volte um pouco para o centro', 'warn', towards(h.u, h.v, 0, 0));
      } else {
        out.hint = hint('no-face', 'Posicione seu rosto dentro do círculo', 'info');
      }
      return out;
    }
    this.lastSeen = now;
    if (obs.faceCount > 1) {
      this.hold = null;
      out.hint = hint('many-faces', 'Deixe apenas o seu rosto na câmera', 'warn');
      return out;
    }

    const sweeping = this.phase === 'sweep';
    const head = headVector(obs.pose, sweeping ? this.baseline : undefined);
    out.head = head;
    this.lastHead = head;

    const problem = this.framingProblem(obs, sweeping);
    if (problem) {
      this.hold = null;
      out.hint = problem;
      return out;
    }

    return sweeping ? this.updateSweep(obs, head, now, out) : this.updateAlign(obs, head, now, out);
  }

  framingProblem(obs, sweeping) {
    if (obs.brightness != null && obs.brightness < QUALITY.minBrightness) {
      return hint('dark', 'Está escuro — procure um lugar mais iluminado', 'warn');
    }
    if (obs.brightness != null && obs.brightness > QUALITY.maxBrightness) {
      return hint('bright', 'Luz forte demais — evite luz atrás de você', 'warn');
    }
    const minWidth = FRAMING.minFaceWidth * (sweeping ? 0.75 : 1);
    if (obs.faceWidth < minWidth) return hint('closer', 'Aproxime o rosto da câmera', 'info');
    if (obs.faceWidth > FRAMING.maxFaceWidth) return hint('farther', 'Afaste um pouco o rosto', 'info');
    const tol = sweeping ? FRAMING.sweepCenterTolerance : FRAMING.centerTolerance;
    if (Math.hypot(obs.offset.x, obs.offset.y) > tol) {
      const l = Math.hypot(obs.offset.x, obs.offset.y);
      return hint('center', 'Centralize o rosto no círculo', 'info', { x: -obs.offset.x / l, y: -obs.offset.y / l }, 'screen');
    }
    return null;
  }

  updateAlign(obs, head, now, out) {
    if (Math.abs(obs.pose.roll) > 12) {
      this.hold = null;
      out.hint = hint('roll', 'Endireite a cabeça', 'info');
      return out;
    }
    if (Math.abs(head.yaw) > 9 || Math.abs(head.pitch) > 10) {
      this.hold = null;
      out.hint = hint('look', 'Olhe diretamente para a câmera', 'info', towards(head.u, head.v, 0, 0));
      return out;
    }
    if (obs.eyesOpen === false) {
      this.hold = null;
      out.hint = hint('eyes', 'Mantenha os olhos abertos', 'info');
      return out;
    }
    if (obs.speed > QUALITY.maxSpeedFront || (obs.sharpness != null && obs.sharpness < QUALITY.minSharpness)) {
      this.hold = null;
      out.hint = hint('still', 'Fique parado um instante…', 'info');
      return out;
    }
    out.holdProgress = this.holdFor('front', now, QUALITY.frontHoldMs);
    out.hint = hint('hold-front', 'Perfeito! Segure assim…', 'good');
    if (out.holdProgress >= 1) {
      this.capture('front', obs.pose);
      out.capture = 'front';
    }
    return out;
  }

  updateSweep(obs, head, now, out) {
    const target = SECTOR_BY_ID[this.target];
    if (head.r > POSE_TARGETS.maxRadius) {
      this.hold = null;
      out.hint = hint('too-far', 'Volte um pouco — virou demais', 'warn', towards(head.u, head.v, 0, 0));
      return out;
    }

    const steady = obs.speed <= QUALITY.maxSpeedSweep && (obs.sharpness == null || obs.sharpness >= QUALITY.minSharpness * 0.7);
    if (head.r >= 1) {
      const sector = nearestSector(head.angle);
      if (!this.captured.has(sector.id) && !this.skipped.has(sector.id) && steady) {
        out.holdProgress = this.holdFor(sector.id, now, QUALITY.sectorHoldMs);
        if (out.holdProgress >= 1) {
          this.capture(sector.id, obs.pose);
          out.capture = sector.id;
          out.hint = hint(`captured-${sector.id}`, 'Isso!', 'good');
          return out;
        }
        out.hint = hint(`hold-${sector.id}`, 'Segure…', 'good');
        return out;
      }
      if (!steady) {
        this.hold = null;
        out.hint = hint('slow', 'Mais devagar…', 'info');
        return out;
      }
    } else {
      this.hold = null;
    }

    if (!target) return out;
    const tu = 1.3 * Math.cos((target.angle * Math.PI) / 180);
    const tv = 1.3 * Math.sin((target.angle * Math.PI) / 180);
    const dir = towards(head.u, head.v, tu, tv);
    const onTrack = head.r > 0.45 && angleDiff(head.angle, target.angle) < 35;
    out.hint = onTrack
      ? hint(`more-${target.id}`, 'Isso, continue… mais um pouco', 'info', dir)
      : hint(`target-${target.id}`, target.hint, 'info', dir);
    return out;
  }
}

// ---------------------------------------------------------------- modo foto passo a passo
// Para quando não há câmera ao vivo: a pessoa tira uma foto por pose e o app diz se ficou
// boa ou para onde virar antes de tirar de novo.

export const PHOTO_STEPS = ['front', 'left', 'right', 'up', 'down'];
export const PHOTO_REQUIRED = ['front', 'left', 'right'];
export const PHOTO_GUIDE = {
  front: { title: 'De frente', how: 'Segure o aparelho na altura dos olhos, com o rosto inteiro na foto, e olhe direto para a câmera.' },
  left: { title: 'Perfil esquerdo', how: 'Vire o rosto uns 45° para a sua esquerda, com o queixo reto. O rosto inteiro precisa aparecer.' },
  right: { title: 'Perfil direito', how: 'Vire o rosto uns 45° para a sua direita, com o queixo reto. O rosto inteiro precisa aparecer.' },
  up: { title: 'Olhando para cima', how: 'Levante o queixo uns 25°, sem virar para os lados.' },
  down: { title: 'Olhando para baixo', how: 'Abaixe o queixo uns 20°, sem virar para os lados.' },
};
const CARDINAL = SECTORS.filter((s) => PHOTO_STEPS.includes(s.id));

export function directionPhrase(dir) {
  const h = Math.abs(dir.x) > 0.38 ? (dir.x < 0 ? 'para a esquerda' : 'para a direita') : '';
  const v = Math.abs(dir.y) > 0.38 ? (dir.y > 0 ? 'para cima' : 'para baixo') : '';
  if (h && v) return `Vire mais ${h} e ${v}`;
  if (h) return `Vire mais ${h}`;
  return v === 'para cima' ? 'Levante mais o queixo' : 'Abaixe mais o queixo';
}

// obs: { faceCount, pose, faceWidthRatio, inside, brightness }
// state: { captured: Set, skipped: Set, baseline }
// Retorna { ok, step?, hint: { key, text, tone, dir } }
export function evaluatePhoto(obs, { captured, skipped = new Set(), baseline }) {
  const fail = (key, text, dir = null) => ({ ok: false, hint: hint(key, text, 'warn', dir) });
  if (!obs.faceCount) return fail('no-face', 'Não encontrei um rosto nessa foto. Use boa luz e deixe o rosto inteiro na imagem.');
  if (obs.faceCount > 1) return fail('many-faces', 'Apareceu mais de um rosto. Tire outra foto só com você.');
  if (!obs.inside) return fail('cut', 'Parte do rosto ficou fora da foto. Afaste um pouco a câmera.');
  if (obs.faceWidthRatio < 0.15) return fail('small', 'O rosto ficou pequeno na foto. Aproxime a câmera.');
  if (obs.brightness != null && obs.brightness < QUALITY.minBrightness) {
    return fail('dark', 'A foto ficou escura. Procure um lugar mais iluminado.');
  }

  if (!captured.has('front')) {
    const head = headVector(obs.pose);
    if (Math.abs(head.yaw) > 12 || Math.abs(head.pitch) > 12) {
      return fail('look', 'Para a primeira foto, olhe direto para a câmera.', towards(head.u, head.v, 0, 0));
    }
    return { ok: true, step: 'front', hint: hint('ok-front', 'Foto de frente registrada!', 'good') };
  }

  const target = PHOTO_STEPS.find((s) => !captured.has(s) && !skipped.has(s));
  const targetSector = SECTOR_BY_ID[target];
  const head = headVector(obs.pose, baseline);
  if (head.r > POSE_TARGETS.maxRadius) {
    return fail('too-far', 'Virou demais: parte do rosto sumiu. Vire um pouco menos.', towards(head.u, head.v, 0, 0));
  }
  if (head.r < 0.8) {
    if (!targetSector) return fail('weak', 'Vire mais a cabeça para registrar outro ângulo.');
    const tu = 1.2 * Math.cos((targetSector.angle * Math.PI) / 180);
    const tv = 1.2 * Math.sin((targetSector.angle * Math.PI) / 180);
    const dir = towards(head.u, head.v, tu, tv);
    return fail(`weak-${target}`, `${directionPhrase(dir)} e tire de novo.`, dir);
  }
  let sector = CARDINAL[0];
  for (const s of CARDINAL) if (angleDiff(head.angle, s.angle) < angleDiff(head.angle, sector.angle)) sector = s;
  if (captured.has(sector.id)) {
    const next = targetSector ? PHOTO_GUIDE[target].title.toLowerCase() : 'outro ângulo';
    return fail(`repeat-${sector.id}`, `Essa pose já foi registrada. Agora falta: ${next}.`);
  }
  return { ok: true, step: sector.id, hint: hint(`ok-${sector.id}`, `${PHOTO_GUIDE[sector.id].title} registrado!`, 'good') };
}
