// Grupos e nomes dos 478 pontos do MediaPipe Face Landmarker.
// "Direito/esquerdo" referem-se ao lado da própria pessoa (não da imagem).

import { FACE_OVAL_LOOP } from './face_topology.js';

export const LIPS = [
  61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 185, 40, 39, 37, 0, 267, 269, 270, 409,
  78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 191, 80, 81, 82, 13, 312, 311, 310, 415,
];
export const RIGHT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 246, 161, 160, 159, 158, 157, 173];
export const LEFT_EYE = [263, 249, 390, 373, 374, 380, 381, 382, 362, 466, 388, 387, 386, 385, 384, 398];
export const RIGHT_EYEBROW = [46, 53, 52, 65, 55, 70, 63, 105, 66, 107];
export const LEFT_EYEBROW = [276, 283, 282, 295, 285, 300, 293, 334, 296, 336];
export const RIGHT_IRIS = [468, 469, 470, 471, 472];
export const LEFT_IRIS = [473, 474, 475, 476, 477];
export const NOSE = [
  1, 2, 4, 5, 6, 19, 44, 45, 48, 49, 51, 64, 94, 97, 98, 99, 115, 122, 125, 131, 134, 141, 168,
  195, 196, 197, 198, 209, 217, 218, 219, 220, 236, 237, 238, 239, 240, 241, 242, 248, 250, 274,
  275, 278, 279, 281, 294, 305, 326, 327, 328, 331, 344, 351, 354, 358, 360, 363, 370, 419, 420,
  429, 437, 438, 439, 440, 456, 457, 458, 459, 460, 461, 462,
];

// Pontos de referência usados como âncoras no bloco geométrico do descritor.
export const ANCHORS = [
  1, 4, 6, 10, 152, 33, 133, 263, 362, 61, 291, 0, 17, 234, 454, 127,
  356, 172, 397, 70, 300, 105, 334, 98, 327, 168, 199, 50, 280, 468, 473, 9,
];

export const RIGHT_EYE_OUTER = 33;
export const LEFT_EYE_OUTER = 263;
export const RIGHT_IRIS_CENTER = 468;
export const LEFT_IRIS_CENTER = 473;
export const NOSE_TIP = 1;

const NAMED = {
  1: 'Ponta do nariz', 4: 'Dorso do nariz', 6: 'Raiz do nariz', 168: 'Entre os olhos',
  10: 'Topo da testa', 9: 'Glabela', 152: 'Queixo', 199: 'Base do queixo',
  33: 'Canto externo do olho direito', 133: 'Canto interno do olho direito',
  263: 'Canto externo do olho esquerdo', 362: 'Canto interno do olho esquerdo',
  159: 'Pálpebra superior direita', 145: 'Pálpebra inferior direita',
  386: 'Pálpebra superior esquerda', 374: 'Pálpebra inferior esquerda',
  468: 'Centro da íris direita', 473: 'Centro da íris esquerda',
  61: 'Canto direito da boca', 291: 'Canto esquerdo da boca',
  0: 'Lábio superior (centro)', 13: 'Lábio superior (interno)', 14: 'Lábio inferior (interno)', 17: 'Lábio inferior (centro)',
  98: 'Narina direita', 327: 'Narina esquerda', 2: 'Base do nariz',
  234: 'Bochecha direita (borda)', 454: 'Bochecha esquerda (borda)',
  50: 'Maçã do rosto direita', 280: 'Maçã do rosto esquerda',
  127: 'Têmpora direita', 356: 'Têmpora esquerda',
  172: 'Mandíbula direita', 397: 'Mandíbula esquerda',
  70: 'Sobrancelha direita (externa)', 105: 'Sobrancelha direita (arco)', 107: 'Sobrancelha direita (interna)',
  300: 'Sobrancelha esquerda (externa)', 334: 'Sobrancelha esquerda (arco)', 336: 'Sobrancelha esquerda (interna)',
};

const REGION_OF = new Map();
function tag(list, name) { for (const i of list) if (!REGION_OF.has(i)) REGION_OF.set(i, name); }
tag(RIGHT_IRIS, 'Íris direita');
tag(LEFT_IRIS, 'Íris esquerda');
tag(LIPS, 'Lábios');
tag(RIGHT_EYE, 'Olho direito');
tag(LEFT_EYE, 'Olho esquerdo');
tag(RIGHT_EYEBROW, 'Sobrancelha direita');
tag(LEFT_EYEBROW, 'Sobrancelha esquerda');
tag(NOSE, 'Nariz');
tag(FACE_OVAL_LOOP, 'Contorno do rosto');

export function regionOf(index) {
  return REGION_OF.get(index) || 'Superfície da face';
}

export function landmarkName(index) {
  return NAMED[index] || regionOf(index);
}

// Peso de rigidez: lábios, pálpebras e íris mudam com a expressão e pesam menos no alinhamento.
export const RIGIDITY = (() => {
  const w = new Float32Array(478).fill(1);
  for (const i of LIPS) w[i] = 0.15;
  for (const i of [...RIGHT_EYE, ...LEFT_EYE]) w[i] = 0.35;
  for (const i of [...RIGHT_IRIS, ...LEFT_IRIS]) w[i] = 0;
  for (const i of [152, 148, 176, 149, 150, 377, 400, 378, 379, 199, 175, 171, 396]) w[i] = 0.3; // queixo acompanha a mandíbula
  return w;
})();
