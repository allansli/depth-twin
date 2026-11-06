import * as THREE from 'three';
import { particleFragment, particleVertex, veilFragment, veilVertex } from './shaders';

type TwinMode = 'particles' | 'veil';

type TwinUniforms = Record<string, THREE.IUniform>;

function makeTexture(width: number, height: number): THREE.DataTexture {
  const data = new Uint8Array(width * height);
  const texture = new THREE.DataTexture(data, width, height, THREE.RedFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = true;
  texture.unpackAlignment = 1;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function pointsGeometry(cols: number, rows: number): THREE.BufferGeometry {
  const count = cols * rows;
  const position = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const normal = new Float32Array(count * 3);
  let index = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const u = (col + 0.5) / cols;
      const v = (row + 0.5) / rows;
      position[index * 3] = u - 0.5;
      position[index * 3 + 1] = v - 0.5;
      uv[index * 2] = u;
      uv[index * 2 + 1] = v;
      normal[index * 3 + 2] = 1;
      index++;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  return geometry;
}

export class TwinScene {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly root = new THREE.Group();
  private videoTexture: THREE.VideoTexture | null = null;
  private depthA = makeTexture(4, 4);
  private depthB = makeTexture(4, 4);
  private mix = 1;
  private fadeMs = 140;
  private cols = 0;
  private rows = 0;
  private points: THREE.Points;
  private shell: THREE.Points;
  private veil: THREE.Mesh;
  private pointMaterial: THREE.ShaderMaterial;
  private shellMaterial: THREE.ShaderMaterial;
  private veilMaterial: THREE.ShaderMaterial;
  private mode: TwinMode = 'particles';
  private modeMix = 0;
  private reveal = 0;
  private frozen = false;
  private reduced = false;
  private parallax = 0;
  private parallaxTarget = 0;
  private videoAspect = 16 / 9;
  private last = performance.now();
  private texel = new THREE.Vector2(1 / 160, 1 / 90);
  hasDepth = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x09090b, 1);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 30);
    this.camera.position.set(0, 0, 3.15);
    this.scene.add(this.root);

    const shared = (): TwinUniforms => ({
      uDepthA: { value: this.depthA },
      uDepthB: { value: this.depthB },
      uVideo: { value: null },
      uMix: { value: 1 },
      uTime: { value: 0 },
      uDepthScale: { value: 0.46 },
      uShell: { value: 0 },
      uFrozen: { value: 0 },
      uPixelRatio: { value: 1 },
      uOpacity: { value: 0 },
      uTexel: { value: this.texel },
    });

    this.pointMaterial = new THREE.ShaderMaterial({
      uniforms: shared(),
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    this.shellMaterial = new THREE.ShaderMaterial({
      uniforms: shared(),
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    this.shellMaterial.uniforms.uShell.value = 1;
    this.veilMaterial = new THREE.ShaderMaterial({
      uniforms: shared(),
      vertexShader: veilVertex,
      fragmentShader: veilFragment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const geometry = pointsGeometry(160, 90);
    this.points = new THREE.Points(geometry, this.pointMaterial);
    this.shell = new THREE.Points(geometry, this.shellMaterial);
    this.veil = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 140, 78), this.veilMaterial);
    this.points.renderOrder = 2;
    this.shell.renderOrder = 1;
    this.veil.renderOrder = 0;
    this.root.add(this.veil, this.shell, this.points);
    this.resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
  }

  attachVideo(video: HTMLVideoElement) {
    if (this.videoTexture) this.videoTexture.dispose();
    const texture = new THREE.VideoTexture(video);
    texture.colorSpace = THREE.NoColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    this.videoTexture = texture;
    if (video.videoWidth > 0) this.videoAspect = video.videoWidth / video.videoHeight;
  }

  setVideoAspect(aspect: number) {
    if (aspect > 0.05) this.videoAspect = aspect;
  }

  setMode(mode: TwinMode) {
    this.mode = mode;
  }

  setFrozen(frozen: boolean) {
    this.frozen = frozen;
  }

  setParallax(offset: number | null) {
    this.parallaxTarget = offset ?? 0;
  }

  setReducedMotion(reduced: boolean) {
    this.reduced = reduced;
  }

  setFadeMs(ms: number) {
    this.fadeMs = Math.min(280, Math.max(90, ms));
  }

  pushDepth(data: Uint8Array, cols: number, rows: number) {
    if (cols !== this.cols || rows !== this.rows) {
      this.depthA.dispose();
      this.depthB.dispose();
      this.depthA = makeTexture(cols, rows);
      this.depthB = makeTexture(cols, rows);
      this.cols = cols;
      this.rows = rows;
      this.texel.set(1 / cols, 1 / rows);
      this.mix = 1;
      const geometry = pointsGeometry(cols, rows);
      this.points.geometry.dispose();
      this.shell.geometry.dispose();
      this.points.geometry = geometry;
      this.shell.geometry = geometry;
    }
    if (this.mix > 0.5) {
      const swap = this.depthA;
      this.depthA = this.depthB;
      this.depthB = swap;
    }
    (this.depthB.image.data as Uint8Array).set(data);
    this.depthB.needsUpdate = true;
    this.mix = 0;
    this.hasDepth = true;
  }

  resize(width: number, height: number) {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(Math.max(1, width), Math.max(1, height), false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.fit();
  }

  tick(now: number) {
    const dt = Math.min(48, now - this.last);
    this.last = now;
    if (this.mix < 1) this.mix = Math.min(1, this.mix + dt / this.fadeMs);
    const targetMode = this.mode === 'veil' ? 1 : 0;
    this.modeMix += (targetMode - this.modeMix) * (1 - Math.exp(-dt / 180));
    if (this.hasDepth) this.reveal = Math.min(1, this.reveal + dt / 700);
    this.parallax += (this.parallaxTarget - this.parallax) * (1 - Math.exp(-dt / 220));

    const seconds = now / 1000;
    const motion = this.reduced ? 0 : this.frozen ? 0.18 : 1;
    this.root.rotation.y = Math.sin(seconds * 0.17) * 0.045 * motion + this.parallax * 0.32;
    this.root.rotation.x = Math.sin(seconds * 0.13) * 0.025 * motion;
    this.fit();

    const pointOpacity = (1 - this.modeMix) * this.reveal;
    const veilOpacity = this.modeMix * this.reveal;
    this.points.visible = pointOpacity > 0.02;
    this.shell.visible = pointOpacity > 0.02;
    this.veil.visible = veilOpacity > 0.02;
    this.writeUniforms(this.pointMaterial, seconds, pointOpacity, 0);
    this.writeUniforms(this.shellMaterial, seconds, pointOpacity, 1);
    this.writeUniforms(this.veilMaterial, seconds, veilOpacity, 0);
    this.renderer.render(this.scene, this.camera);
  }

  capture(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  private writeUniforms(material: THREE.ShaderMaterial, seconds: number, opacity: number, shell: number) {
    const uniforms = material.uniforms;
    uniforms.uDepthA.value = this.depthA;
    uniforms.uDepthB.value = this.depthB;
    uniforms.uVideo.value = this.videoTexture;
    uniforms.uMix.value = this.mix;
    uniforms.uTime.value = seconds;
    uniforms.uFrozen.value = this.frozen ? 1 : 0;
    uniforms.uOpacity.value = opacity;
    uniforms.uShell.value = shell;
    uniforms.uPixelRatio.value = this.renderer.getPixelRatio();
    uniforms.uTexel.value = this.texel;
  }

  private fit() {
    const dist = this.camera.position.z;
    const frustumH = 2 * Math.tan((this.camera.fov * Math.PI) / 360) * dist;
    const frustumW = frustumH * this.camera.aspect;
    let planeH = frustumH;
    let planeW = planeH * this.videoAspect;
    const scale = Math.max(frustumW / planeW, frustumH / planeH);
    planeW *= scale;
    planeH *= scale;
    this.root.scale.set(planeW, planeH, planeW);
  }
}
