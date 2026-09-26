// Métricas de qualidade da imagem na região do rosto: brilho médio e nitidez
// (variância do Laplaciano em uma versão reduzida do rosto).

const SIZE = 64;

export class FrameAnalyzer {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.gray = new Float32Array(SIZE * SIZE);
  }

  // box em pixels da imagem original: { x0, y0, x1, y1 }
  analyze(source, box) {
    // Usa só o miolo do rosto para não misturar fundo e cabelo.
    const w = box.x1 - box.x0, h = box.y1 - box.y0;
    const sx = box.x0 + w * 0.18, sy = box.y0 + h * 0.15;
    const sw = w * 0.64, sh = h * 0.7;
    if (sw < 8 || sh < 8) return { brightness: 0, sharpness: 0 };
    this.ctx.drawImage(source, sx, sy, sw, sh, 0, 0, SIZE, SIZE);
    const { data } = this.ctx.getImageData(0, 0, SIZE, SIZE);
    let sum = 0;
    for (let i = 0, j = 0; i < SIZE * SIZE; i++, j += 4) {
      const g = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
      this.gray[i] = g;
      sum += g;
    }
    const brightness = sum / (SIZE * SIZE);
    let lsum = 0, lsq = 0, n = 0;
    for (let y = 1; y < SIZE - 1; y++) {
      for (let x = 1; x < SIZE - 1; x++) {
        const i = y * SIZE + x;
        const lap = this.gray[i - 1] + this.gray[i + 1] + this.gray[i - SIZE] + this.gray[i + SIZE] - 4 * this.gray[i];
        lsum += lap; lsq += lap * lap; n++;
      }
    }
    const mean = lsum / n;
    return { brightness, sharpness: lsq / n - mean * mean };
  }
}

// Caixa envolvente dos landmarks em pixels da imagem.
export function landmarkBox(landmarks, width, height) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of landmarks) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  return { x0: x0 * width, y0: y0 * height, x1: x1 * width, y1: y1 * height };
}
