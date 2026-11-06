import * as THREE from 'three';
import { composeStill, flipRgba, STILL_H, STILL_W } from '../lib/capture';
import { type MaterialId } from '../lib/materials';
import {
  blitVertex,
  meshFragment,
  meshVertex,
  particleFragment,
  particleVertex,
  presentFragment,
  trailFragment,
} from './shaders';

interface Look {
  trail: number;
  bloom: number;
  decay: number;
  kind: number;
  ripple: number;
}

const LOOK: Record<MaterialId, Look> = {
  particles: { trail: 0.28, bloom: 0.06, decay: 0.86, kind: 4, ripple: 0 },
  holo: { trail: 0.4, bloom: 0.28, decay: 0.84, kind: 0, ripple: 1 },
  metal: { trail: 0.16, bloom: 0.1, decay: 0.74, kind: 1, ripple: 0.35 },
  wire: { trail: 0.5, bloom: 0.55, decay: 0.86, kind: 2, ripple: 0.15 },
  ember: { trail: 0.58, bloom: 0.36, decay: 0.88, kind: 3, ripple: 0.25 },
};

function makeDepth(width: number, height: number): THREE.DataTexture {
  const data = new Uint8Array(width * height * 4);
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = true;
  texture.unpackAlignment = 1;
  texture.colorSpace = THREE.NoColorSpace;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function writeDepth(texture: THREE.DataTexture, data: Uint8Array) {
  const image = texture.image.data as Uint8Array;
  const n = Math.min(data.length, (image.length / 4) | 0);
  for (let i = 0; i < n; i++) {
    const value = data[i];
    const o = i * 4;
    image[o] = value;
    image[o + 1] = value;
    image[o + 2] = value;
    image[o + 3] = 255;
  }
  texture.needsUpdate = true;
}

function makeRed(width: number, height: number): THREE.DataTexture {
  const data = new Uint8Array(width * height);
  const texture = new THREE.DataTexture(data, width, height, THREE.RedFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = true;
  texture.unpackAlignment = 1;
  texture.colorSpace = THREE.NoColorSpace;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function makeRgba(width: number, height: number, rgba: Uint8Array): THREE.DataTexture {
  const texture = new THREE.DataTexture(rgba, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function target(width: number, height: number, depth: boolean): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(Math.max(2, width), Math.max(2, height), {
    depthBuffer: depth,
    stencilBuffer: false,
    magFilter: THREE.LinearFilter,
    minFilter: THREE.LinearFilter,
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
  });
  rt.texture.colorSpace = THREE.NoColorSpace;
  return rt;
}

function pointsGeometry(cols: number, rows: number): THREE.BufferGeometry {
  const count = cols * rows;
  const position = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  let index = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const u = (col + 0.5) / cols;
      const v = (row + 0.5) / rows;
      position[index * 3] = u - 0.5;
      position[index * 3 + 1] = v - 0.5;
      uv[index * 2] = u;
      uv[index * 2 + 1] = v;
      index++;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

function uniforms(): Record<string, THREE.IUniform> {
  return {
    uDepthA: { value: null },
    uDepthB: { value: null },
    uVideo: { value: null },
    uPaint: { value: null },
    uMix: { value: 1 },
    uTime: { value: 0 },
    uDepthScale: { value: 0.62 },
    uShell: { value: 0 },
    uSpark: { value: 0 },
    uFrozen: { value: 0 },
    uPresence: { value: 0 },
    uPixelRatio: { value: 1 },
    uOpacity: { value: 0 },
    uTexel: { value: new THREE.Vector2(1 / 160, 1 / 90) },
    uRipple: { value: 0 },
    uKind: { value: 0 },
    uPrev: { value: null },
    uBeauty: { value: null },
    uTrail: { value: null },
    uDecay: { value: 0.88 },
    uTrailAmt: { value: 0.4 },
    uBloom: { value: 0.3 },
  };
}

export class TwinScene {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly root = new THREE.Group();
  private readonly blitScene = new THREE.Scene();
  private readonly blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  private videoTexture: THREE.VideoTexture | null = null;
  private readonly blank: THREE.DataTexture;
  private readonly black: THREE.DataTexture;
  private depthA = makeDepth(4, 4);
  private depthB = makeDepth(4, 4);
  private paintTex = makeRed(4, 4);
  private mix = 1;
  private fadeMs = 140;
  private cols = 0;
  private rows = 0;
  private readonly points: THREE.Points;
  private readonly shell: THREE.Points;
  private readonly sparks: THREE.Points;
  private readonly mesh: THREE.Mesh;
  private readonly pointMaterial: THREE.ShaderMaterial;
  private readonly shellMaterial: THREE.ShaderMaterial;
  private readonly sparkMaterial: THREE.ShaderMaterial;
  private readonly meshMaterial: THREE.ShaderMaterial;
  private readonly trailMaterial: THREE.ShaderMaterial;
  private readonly presentMaterial: THREE.ShaderMaterial;
  private material: MaterialId = 'particles';
  private materialReveal = 1;
  private reveal = 0;
  private frozen = false;
  private reduced = false;
  private presence = 0;
  private parallax = 0;
  private parallaxTarget = 0;
  private videoAspect = 16 / 9;
  private last = performance.now();
  private readonly texel = new THREE.Vector2(1 / 160, 1 / 90);
  private readonly presentTexel = new THREE.Vector2(1 / 1280, 1 / 720);
  private readonly bufSize = new THREE.Vector2();
  private beauty: THREE.WebGLRenderTarget | null = null;
  private trailRead: THREE.WebGLRenderTarget | null = null;
  private trailWrite: THREE.WebGLRenderTarget | null = null;
  private stillBeauty: THREE.WebGLRenderTarget | null = null;
  private stillFrame: THREE.WebGLRenderTarget | null = null;
  private paintCols = 4;
  private paintRows = 4;
  private meshGlow = false;
  hasDepth = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x07060f, 1);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 30);
    this.camera.position.set(0, 0, 3.15);
    this.scene.add(this.root);

    this.blank = makeRgba(1, 1, new Uint8Array([10, 8, 18, 255]));
    this.black = makeRgba(1, 1, new Uint8Array([0, 0, 0, 255]));

    this.pointMaterial = new THREE.ShaderMaterial({
      uniforms: uniforms(),
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending,
    });
    this.shellMaterial = new THREE.ShaderMaterial({
      uniforms: uniforms(),
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending,
    });
    this.shellMaterial.uniforms.uShell.value = 1;
    this.sparkMaterial = new THREE.ShaderMaterial({
      uniforms: uniforms(),
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.sparkMaterial.uniforms.uSpark.value = 1;
    this.meshMaterial = new THREE.ShaderMaterial({
      uniforms: uniforms(),
      vertexShader: meshVertex,
      fragmentShader: meshFragment,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    this.trailMaterial = new THREE.ShaderMaterial({
      uniforms: uniforms(),
      vertexShader: blitVertex,
      fragmentShader: trailFragment,
      depthTest: false,
      depthWrite: false,
    });
    this.presentMaterial = new THREE.ShaderMaterial({
      uniforms: uniforms(),
      vertexShader: blitVertex,
      fragmentShader: presentFragment,
      depthTest: false,
      depthWrite: false,
    });

    const geometry = pointsGeometry(160, 90);
    this.points = new THREE.Points(geometry, this.pointMaterial);
    this.shell = new THREE.Points(geometry, this.shellMaterial);
    this.sparks = new THREE.Points(geometry, this.sparkMaterial);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 160, 90), this.meshMaterial);
    this.points.renderOrder = 2;
    this.shell.renderOrder = 3;
    this.sparks.renderOrder = 4;
    this.mesh.renderOrder = 1;
    this.root.add(this.mesh, this.shell, this.points, this.sparks);

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.presentMaterial);
    this.blitScene.add(this.quad);
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

  setMaterial(id: MaterialId) {
    if (id === this.material) return;
    this.material = id;
    this.materialReveal = 0;
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

  setPresence(value: number) {
    this.presence = Math.min(1, Math.max(0, value));
  }

  /** Skip the fade-in. Used by the synthetic look so the first frame is already the material. */
  revealNow() {
    this.reveal = 1;
    this.materialReveal = 1;
  }

  setFadeMs(ms: number) {
    this.fadeMs = Math.min(280, Math.max(90, ms));
  }

  setPaint(data: Uint8Array, cols: number, rows: number) {
    if (cols < 2 || rows < 2) return;
    if (cols !== this.paintCols || rows !== this.paintRows) {
      this.paintTex.dispose();
      this.paintTex = makeRed(cols, rows);
      this.paintCols = cols;
      this.paintRows = rows;
    }
    const image = this.paintTex.image.data as Uint8Array;
    image.set(data.subarray(0, image.length));
    this.paintTex.needsUpdate = true;
  }

  pushDepth(data: Uint8Array, cols: number, rows: number) {
    if (cols !== this.cols || rows !== this.rows) {
      this.depthA.dispose();
      this.depthB.dispose();
      this.depthA = makeDepth(cols, rows);
      this.depthB = makeDepth(cols, rows);
      this.cols = cols;
      this.rows = rows;
      this.texel.set(1 / cols, 1 / rows);
      this.mix = 1;
      const geometry = pointsGeometry(cols, rows);
      this.points.geometry.dispose();
      this.points.geometry = geometry;
      this.shell.geometry = geometry;
      this.sparks.geometry = geometry;
    }
    if (this.mix > 0.5) {
      const swap = this.depthA;
      this.depthA = this.depthB;
      this.depthB = swap;
    }
    writeDepth(this.depthB, data);
    this.mix = 0;
    this.hasDepth = true;
  }

  resize(width: number, height: number) {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, this.reduced ? 1.15 : 1.5);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(Math.max(1, width), Math.max(1, height), false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    const buf = this.renderer.getDrawingBufferSize(this.bufSize);
    this.ensureTargets(buf.x, buf.y);
    this.fit();
  }

  tick(now: number) {
    const dt = Math.min(48, now - this.last);
    this.last = now;
    if (this.mix < 1) this.mix = Math.min(1, this.mix + dt / this.fadeMs);
    if (this.hasDepth) this.reveal = Math.min(1, this.reveal + dt / 520);
    this.materialReveal = Math.min(1, this.materialReveal + dt / 240);
    this.parallax += (this.parallaxTarget - this.parallax) * (1 - Math.exp(-dt / 220));

    const seconds = now / 1000;
    const motion = this.reduced ? 0 : this.frozen ? 0.15 : 1;
    this.root.rotation.y = Math.sin(seconds * 0.17) * 0.04 * motion + this.parallax * 0.32;
    this.root.rotation.x = Math.sin(seconds * 0.13) * 0.02 * motion;
    this.fit();
    this.layout(seconds);
    this.renderLive();
  }

  captureStill(video: HTMLVideoElement | null, split: boolean): string {
    const prevAspect = this.camera.aspect;
    const prevTrail = this.presentMaterial.uniforms.uTrailAmt.value as number;
    const prevBloom = this.presentMaterial.uniforms.uBloom.value as number;
    try {
      this.camera.aspect = STILL_W / STILL_H;
      this.camera.updateProjectionMatrix();
      this.fit();
      this.layout(performance.now() / 1000);
      if (!this.stillBeauty) this.stillBeauty = target(STILL_W, STILL_H, false);
      if (!this.stillFrame) this.stillFrame = target(STILL_W, STILL_H, false);
      this.renderBeauty(this.stillBeauty);
      this.presentTexel.set(1 / STILL_W, 1 / STILL_H);
      this.presentMaterial.uniforms.uBeauty.value = this.stillBeauty.texture;
      this.presentMaterial.uniforms.uTrail.value = this.black;
      this.presentMaterial.uniforms.uTrailAmt.value = 0;
      this.presentMaterial.uniforms.uBloom.value = Math.max(0.22, this.look().bloom);
      this.presentMaterial.uniforms.uTexel.value = this.presentTexel;
      this.blit(this.presentMaterial, this.stillFrame);
      const raw = new Uint8Array(STILL_W * STILL_H * 4);
      this.renderer.readRenderTargetPixels(this.stillFrame, 0, 0, STILL_W, STILL_H, raw);
      return composeStill(flipRgba(raw, STILL_W, STILL_H), video, split);
    } finally {
      this.camera.aspect = prevAspect;
      this.camera.updateProjectionMatrix();
      this.fit();
      this.presentMaterial.uniforms.uTrailAmt.value = prevTrail;
      this.presentMaterial.uniforms.uBloom.value = prevBloom;
      if (this.beauty) this.presentMaterial.uniforms.uBeauty.value = this.beauty.texture;
      if (this.trailRead) this.presentMaterial.uniforms.uTrail.value = this.trailRead.texture;
    }
  }

  private look(): Look {
    return LOOK[this.material];
  }

  private layout(seconds: number) {
    const look = this.look();
    const fade = this.reveal * this.materialReveal;
    const particles = this.material === 'particles';
    const ember = this.material === 'ember';
    this.points.visible = false;
    this.shell.visible = false;
    this.sparks.visible = ember && fade > 0.02;
    this.mesh.visible = fade > 0.02;
    const glow = this.material === 'holo' || this.material === 'wire' || this.material === 'ember';
    if (glow !== this.meshGlow) {
      this.meshGlow = glow;
      this.meshMaterial.blending = glow ? THREE.AdditiveBlending : THREE.NormalBlending;
      this.meshMaterial.needsUpdate = true;
    }
    this.meshMaterial.uniforms.uKind.value = particles ? 4 : look.kind;
    this.meshMaterial.uniforms.uRipple.value = look.ripple;
    this.applyShared(this.pointMaterial, seconds, particles ? fade : 0);
    this.applyShared(this.shellMaterial, seconds, particles ? fade * 0.85 : 0);
    this.applyShared(this.sparkMaterial, seconds, ember ? fade : 0);
    this.applyShared(this.meshMaterial, seconds, this.mesh.visible ? fade : 0);
    this.shellMaterial.uniforms.uShell.value = 1;
    this.sparkMaterial.uniforms.uSpark.value = 1;
  }

  private renderLive() {
    if (!this.beauty || !this.trailRead || !this.trailWrite) return;
    const look = this.look();
    this.renderBeauty(this.beauty);
    this.trailMaterial.uniforms.uPrev.value = this.trailRead.texture;
    this.trailMaterial.uniforms.uBeauty.value = this.beauty.texture;
    this.trailMaterial.uniforms.uDecay.value = this.reduced ? 0.25 : look.decay;
    this.blit(this.trailMaterial, this.trailWrite);
    const swap = this.trailRead;
    this.trailRead = this.trailWrite;
    this.trailWrite = swap;

    const size = this.renderer.getDrawingBufferSize(this.bufSize);
    this.presentTexel.set(1 / Math.max(1, size.x), 1 / Math.max(1, size.y));
    this.presentMaterial.uniforms.uBeauty.value = this.beauty.texture;
    this.presentMaterial.uniforms.uTrail.value = this.trailRead.texture;
    this.presentMaterial.uniforms.uTrailAmt.value = this.reduced ? 0 : look.trail;
    this.presentMaterial.uniforms.uBloom.value = this.reduced ? 0.08 : look.bloom;
    this.presentMaterial.uniforms.uTexel.value = this.presentTexel;
    this.blit(this.presentMaterial, null);
  }

  private renderBeauty(rt: THREE.WebGLRenderTarget) {
    this.renderer.setRenderTarget(rt);
    this.renderer.setClearColor(0x07060f, 1);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
  }

  private blit(material: THREE.ShaderMaterial, rt: THREE.WebGLRenderTarget | null) {
    this.quad.material = material;
    this.renderer.setRenderTarget(rt);
    this.renderer.render(this.blitScene, this.blitCamera);
  }

  private ensureTargets(width: number, height: number) {
    const bw = Math.max(2, Math.floor(width));
    const bh = Math.max(2, Math.floor(height));
    if (this.beauty && this.beauty.width === bw && this.beauty.height === bh) return;
    this.beauty?.dispose();
    this.trailRead?.dispose();
    this.trailWrite?.dispose();
    this.beauty = target(bw, bh, false);
    this.trailRead = target(Math.max(2, Math.floor(bw / 2)), Math.max(2, Math.floor(bh / 2)), false);
    this.trailWrite = target(this.trailRead.width, this.trailRead.height, false);
  }

  private applyShared(material: THREE.ShaderMaterial, seconds: number, opacity: number) {
    const u = material.uniforms;
    u.uDepthA.value = this.depthA;
    u.uDepthB.value = this.depthB;
    u.uVideo.value = this.videoTexture ?? this.blank;
    u.uPaint.value = this.paintTex;
    u.uMix.value = this.mix;
    u.uTime.value = seconds;
    u.uFrozen.value = this.frozen ? 1 : 0;
    u.uPresence.value = this.presence;
    u.uOpacity.value = opacity;
    u.uPixelRatio.value = this.renderer.getPixelRatio();
    u.uTexel.value = this.texel;
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
