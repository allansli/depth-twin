export const particleVertex = /* glsl */ `
uniform sampler2D uDepthA;
uniform sampler2D uDepthB;
uniform float uMix;
uniform float uTime;
uniform float uDepthScale;
uniform float uShell;
uniform float uFrozen;
uniform float uPixelRatio;

varying vec2 vUv;
varying float vDepth;
varying float vShell;

float sampleDepth(vec2 p) {
  float a = texture2D(uDepthA, p).r;
  float b = texture2D(uDepthB, p).r;
  return mix(a, b, uMix);
}

void main() {
  vUv = uv;
  float d = sampleDepth(uv);
  vDepth = d;
  vShell = uShell;
  float breath = sin(uTime * 0.65 + position.x * 8.0 + position.y * 7.0);
  float amp = mix(0.012, 0.002, uFrozen);
  float z = (d - 0.40) * uDepthScale - uShell * (0.04 + 0.06 * d) + breath * amp * (0.35 + d);
  vec4 mv = modelViewMatrix * vec4(-position.x, position.y, z, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = mix(2.35, 4.4, d) * (uShell > 0.5 ? 1.35 : 1.0);
  gl_PointSize = size * uPixelRatio * (2.15 / max(0.45, -mv.z));
}
`;

export const particleFragment = /* glsl */ `
uniform sampler2D uVideo;
uniform float uOpacity;

varying vec2 vUv;
varying float vDepth;
varying float vShell;

void main() {
  vec2 pc = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(pc, pc);
  if (r2 > 1.0) discard;
  float disc = smoothstep(1.0, 0.18, r2);
  vec3 col = texture2D(uVideo, vUv).rgb;
  vec3 cool = vec3(0.9, 0.94, 1.02);
  vec3 warm = vec3(1.06, 1.0, 0.96);
  col *= mix(cool, warm, smoothstep(0.12, 0.85, vDepth));
  float presence = smoothstep(0.02, 0.38, vDepth);
  float alpha = disc * mix(0.2, 1.0, presence) * uOpacity;
  alpha *= mix(1.0, 0.38, step(0.5, vShell));
  if (alpha < 0.012) discard;
  gl_FragColor = vec4(col, alpha);
}
`;

export const veilVertex = /* glsl */ `
uniform sampler2D uDepthA;
uniform sampler2D uDepthB;
uniform float uMix;
uniform float uTime;
uniform float uDepthScale;
uniform float uFrozen;
uniform vec2 uTexel;

varying vec2 vUv;
varying float vDepth;
varying float vRim;

float sampleDepth(vec2 p) {
  float a = texture2D(uDepthA, clamp(p, 0.0, 1.0)).r;
  float b = texture2D(uDepthB, clamp(p, 0.0, 1.0)).r;
  return mix(a, b, uMix);
}

void main() {
  vUv = uv;
  float d = sampleDepth(uv);
  float dx = sampleDepth(uv + vec2(uTexel.x, 0.0)) - sampleDepth(uv - vec2(uTexel.x, 0.0));
  float dy = sampleDepth(uv + vec2(0.0, uTexel.y)) - sampleDepth(uv - vec2(0.0, uTexel.y));
  vRim = clamp(length(vec2(dx, dy)) * 3.2, 0.0, 1.0);
  vDepth = d;
  float breath = sin(uTime * 0.45 + position.y * 4.0) * mix(0.008, 0.0, uFrozen);
  vec4 mv = modelViewMatrix * vec4(-position.x, position.y, (d - 0.40) * uDepthScale + breath, 1.0);
  gl_Position = projectionMatrix * mv;
}
`;

export const veilFragment = /* glsl */ `
uniform sampler2D uVideo;
uniform float uOpacity;

varying vec2 vUv;
varying float vDepth;
varying float vRim;

void main() {
  vec3 col = texture2D(uVideo, vUv).rgb;
  col = mix(col, vec3(0.86, 0.78, 1.0), vRim * 0.62);
  col *= mix(0.78, 1.06, vDepth);
  float edge = smoothstep(0.0, 0.06, vUv.x) * smoothstep(0.0, 0.06, 1.0 - vUv.x);
  edge *= smoothstep(0.0, 0.08, vUv.y) * smoothstep(0.0, 0.08, 1.0 - vUv.y);
  gl_FragColor = vec4(col, uOpacity * edge);
}
`;
