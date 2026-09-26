// Estimativa e suavização da pose da cabeça (yaw, pitch, roll em graus).
// Convenção do app: yaw > 0 = a pessoa virou para a DIREITA dela; pitch > 0 = olhou para CIMA.

const DEG = 180 / Math.PI;

// Matriz de transformação facial do MediaPipe (4×4, column-major, eixo z do rosto apontando
// para a câmera). A terceira coluna é a direção para onde o rosto aponta.
export function poseFromMatrix(data) {
  const fx = data[8], fy = data[9], fz = data[10];
  const n = Math.hypot(fx, fy, fz) || 1;
  const x = fx / n, y = fy / n, z = fz / n;
  return {
    yaw: -Math.atan2(x, z) * DEG,
    pitch: Math.atan2(y, Math.hypot(x, z)) * DEG,
    roll: Math.atan2(data[1], data[0]) * DEG,
  };
}

export class PoseTracker {
  constructor(alpha = 0.45) {
    this.alpha = alpha;
    this.pose = null;
    this.speed = 0;
    this.lastTime = 0;
  }

  reset() {
    this.pose = null;
    this.speed = 0;
  }

  update(raw, time) {
    if (!this.pose) {
      this.pose = { ...raw };
      this.lastTime = time;
      this.speed = 0;
      return this.pose;
    }
    const a = this.alpha;
    const prev = this.pose;
    const next = {
      yaw: prev.yaw + a * (raw.yaw - prev.yaw),
      pitch: prev.pitch + a * (raw.pitch - prev.pitch),
      roll: prev.roll + a * (raw.roll - prev.roll),
    };
    const dt = Math.max(1, time - this.lastTime) / 1000;
    const instant = Math.hypot(next.yaw - prev.yaw, next.pitch - prev.pitch) / dt;
    this.speed += 0.5 * (instant - this.speed);
    this.pose = next;
    this.lastTime = time;
    return next;
  }
}
