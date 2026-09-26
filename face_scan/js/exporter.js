// Exportação do escaneamento (arquivos para download) e integração com o backend Python.

import { DESCRIPTOR_LAYOUT, DESCRIPTOR_DIM } from './descriptors.js';
import { NUM_LANDMARKS, ASSUMED_IPD_MM } from './config.js';

export function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function float32ToBase64(array) {
  return bytesToBase64(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
}

const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

function triples(flat, decimals) {
  const out = [];
  for (let i = 0; i < flat.length; i += 3) {
    out.push([round(flat[i], decimals), round(flat[i + 1], decimals), round(flat[i + 2], decimals)]);
  }
  return out;
}

// Template biométrico completo. `includeDescriptors` embute os vetores em base64 (≈6 MB).
export function buildTemplate(scan, { includeDescriptors = true } = {}) {
  const template = {
    format: 'attendancecon.face-scan-3d',
    version: 1,
    created_at: scan.createdAt,
    landmark_count: NUM_LANDMARKS,
    mesh_topology: 'mediapipe-canonical-468',
    units: 'mm',
    scale_reference: `distância interpupilar assumida de ${ASSUMED_IPD_MM} mm`,
    measurements_mm: Object.fromEntries(Object.entries(scan.measurements).map(([k, v]) => [k, round(v, 1)])),
    fusion: {
      views: scan.views.length,
      residual_mm: Object.fromEntries(scan.views.map((v, k) => [v.name, round(scan.residualsMm[k], 2)])),
      texture_coverage: round(scan.coverage, 4),
    },
    landmarks_3d: triples(scan.pointsMm, 3),
    normals: triples(scan.normals, 4),
    views: scan.views.map((v) => ({
      name: v.name,
      image_size: [v.width, v.height],
      pose: { yaw: round(v.pose.yaw, 2), pitch: round(v.pose.pitch, 2), roll: round(v.pose.roll, 2) },
      landmarks: v.landmarks.map((p) => [round(p.x, 5), round(p.y, 5), round(p.z, 5)]),
    })),
    descriptors: {
      count: NUM_LANDMARKS,
      dim: DESCRIPTOR_DIM,
      dtype: 'float32',
      byte_order: 'little-endian',
      layout: DESCRIPTOR_LAYOUT,
    },
  };
  if (includeDescriptors) template.descriptors.data_base64 = float32ToBase64(scan.descriptors);
  return template;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function timestampName(prefix, ext) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${prefix}_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.${ext}`;
}

// ---- Backend (face_scan/server.py) ----

async function api(path, options = {}) {
  const res = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

export async function backendAvailable() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch('api/health', { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok && (await res.json()).ok === true;
  } catch {
    return false;
  }
}

export function listStudents() {
  return api('api/students');
}

export async function saveToBackend(scan, idStudent, replace) {
  const textureBlob = await new Promise((r) => scan.textureCanvas.toBlob(r, 'image/png'));
  const textureBytes = new Uint8Array(await textureBlob.arrayBuffer());
  return api('api/faces', {
    method: 'POST',
    body: JSON.stringify({
      id_student: idStudent,
      replace,
      template: buildTemplate(scan, { includeDescriptors: false }),
      descriptors_base64: float32ToBase64(scan.descriptors),
      texture_png_base64: bytesToBase64(textureBytes),
    }),
  });
}
