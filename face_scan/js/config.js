// Configuração central do Face Scan 3D.

export const MEDIAPIPE_VERSION = '1.0.1';
export const MEDIAPIPE_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
export const FACE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// Pontos devolvidos pelo FaceLandmarker: 468 da malha + 10 da íris.
export const NUM_LANDMARKS = 478;
export const NUM_MESH_VERTICES = 468;

// Distância interpupilar média de um adulto, usada para estimar a escala em milímetros.
export const ASSUMED_IPD_MM = 63;

// Resolução pedida à câmera (o navegador entrega a mais próxima disponível).
export const CAMERA_IDEAL = { width: 1280, height: 720 };

// Limiares de ângulo (graus) que definem "virou o suficiente" para cada direção.
export const POSE_TARGETS = {
  yaw: 32,        // perfis esquerdo/direito
  pitchUp: 20,    // olhar para cima
  pitchDown: 16,  // olhar para baixo
  maxRadius: 1.9, // além disso o rastreamento perde precisão → pede para voltar
};

// Enquadramento: frações do diâmetro do círculo-guia.
export const FRAMING = {
  guideRadius: 0.42,     // raio do círculo em fração do palco
  minFaceWidth: 0.42,    // largura mínima do rosto / diâmetro do círculo
  maxFaceWidth: 0.86,
  centerTolerance: 0.09, // desvio máximo do centro (fração do palco) na captura frontal
  sweepCenterTolerance: 0.2,
};

export const QUALITY = {
  minBrightness: 55,
  maxBrightness: 215,
  minSharpness: 12,
  maxSpeedFront: 30,  // graus/s
  maxSpeedSweep: 110,
  frontHoldMs: 700,
  sectorHoldMs: 140,
};

export const TEXTURE_SIZE = 1024;
