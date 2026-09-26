// Visualizador 3D do rosto reconstruído (three.js).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.65, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class FaceViewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 1, 5000);
    this.camera.position.set(0, 0, 430);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 160;
    this.controls.maxDistance = 900;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 1.6;
    this.controls.addEventListener('start', () => { this.controls.autoRotate = false; });

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4250, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 1.9);
    key.position.set(160, 220, 320);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xbfd8ff, 0.7);
    fill.position.set(-260, -40, 160);
    this.scene.add(fill);

    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.raycaster = new THREE.Raycaster();
    this.mode = 'texture';
    this.onPick = null;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.bindPicking();
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    loop();
  }

  resize() {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // mesh: { positions, uvs, triangles } em mm; textureCanvas; points (478×3 mm); pointColors (478×3, 0..1)
  setFace({ mesh, textureCanvas, points, pointColors }) {
    this.group.clear();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(mesh.positions), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(Float32Array.from(mesh.uvs), 2));
    geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(mesh.triangles), 1));
    geometry.computeVertexNormals();

    this.texture = new THREE.CanvasTexture(textureCanvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();

    this.materials = {
      texture: new THREE.MeshStandardMaterial({ map: this.texture, roughness: 0.6, metalness: 0, side: THREE.DoubleSide }),
      clay: new THREE.MeshStandardMaterial({ color: 0xd8d2cc, roughness: 0.5, metalness: 0, side: THREE.DoubleSide }),
    };
    this.mesh = new THREE.Mesh(geometry, this.materials.texture);
    this.mesh.name = 'rosto';
    this.group.add(this.mesh);

    this.wire = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      color: 0x2dd4bf, wireframe: true, transparent: true, opacity: 0.35, depthWrite: false,
    }));
    this.group.add(this.wire);

    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(points), 3));
    pg.setAttribute('color', new THREE.BufferAttribute(Float32Array.from(pointColors), 3));
    this.points = new THREE.Points(pg, new THREE.PointsMaterial({
      size: 4.2, vertexColors: true, map: dotTexture(), transparent: true, alphaTest: 0.4, sizeAttenuation: true,
    }));
    this.group.add(this.points);
    this.pointPositions = points;

    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(2.6, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0xfacc15, depthTest: false }),
    );
    this.marker.renderOrder = 10;
    this.marker.visible = false;
    this.group.add(this.marker);

    geometry.computeBoundingSphere();
    const r = geometry.boundingSphere.radius;
    this.camera.position.set(0, 0, r * 3.6);
    this.controls.target.set(0, 0, 0);
    this.setMode(this.mode);
  }

  setMode(mode) {
    this.mode = mode;
    if (!this.mesh) return;
    this.mesh.visible = mode !== 'points';
    this.mesh.material = mode === 'texture' ? this.materials.texture : this.materials.clay;
    this.wire.visible = mode === 'mesh';
    this.points.visible = mode === 'points' || mode === 'mesh';
    this.points.material.size = mode === 'points' ? 4.2 : 2.4;
  }

  selectPoint(index) {
    if (index == null || !this.pointPositions) {
      this.marker.visible = false;
      return;
    }
    const p = this.pointPositions;
    this.marker.position.set(p[3 * index], p[3 * index + 1], p[3 * index + 2]);
    this.marker.visible = true;
  }

  bindPicking() {
    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 || !this.mesh) return;
      const rect = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.camera);
      const hit = this.raycaster.intersectObject(this.mesh, false)[0];
      let target;
      if (hit) {
        target = this.group.worldToLocal(hit.point.clone());
      } else {
        this.raycaster.params.Points.threshold = 3;
        const ph = this.raycaster.intersectObject(this.points, false)[0];
        if (!ph) return;
        target = this.group.worldToLocal(ph.point.clone());
      }
      const p = this.pointPositions;
      let best = -1, bestD = Infinity;
      for (let i = 0; i < p.length / 3; i++) {
        const d = (p[3 * i] - target.x) ** 2 + (p[3 * i + 1] - target.y) ** 2 + (p[3 * i + 2] - target.z) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0 && Math.sqrt(bestD) < 12) this.onPick?.(best);
    });
  }

  snapshot() {
    this.renderer.render(this.scene, this.camera);
    return new Promise((resolve) => this.renderer.domElement.toBlob(resolve, 'image/png'));
  }

  // Exporta só a malha texturizada, em metros (unidade do glTF).
  async exportGLB() {
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const root = new THREE.Group();
    root.name = 'FaceScan3D';
    const mesh = new THREE.Mesh(this.mesh.geometry, this.materials.texture);
    mesh.name = 'rosto';
    mesh.scale.setScalar(0.001);
    root.add(mesh);
    const exporter = new GLTFExporter();
    const buffer = await exporter.parseAsync(root, { binary: true });
    return new Blob([buffer], { type: 'model/gltf-binary' });
  }

  dispose() {
    this.running = false;
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
