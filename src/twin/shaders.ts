export const particleVertex = /* glsl */ `
uniform sampler2D uDepthA;
uniform sampler2D uDepthB;
uniform float uMix;
uniform float uTime;
uniform float uDepthScale;
uniform float uShell;
uniform float uSpark;
uniform float uFrozen;
uniform float uPresence;
uniform float uPixelRatio;
uniform vec2 uTexel;

varying vec2 vUv;
varying float vDepth;
varying float vShell;
varying float vHash;
varying float vLife;

float sampleDepth(vec2 p) {
  float a = texture2D(uDepthA, clamp(p, 0.0, 1.0)).r;
  float b = texture2D(uDepthB, clamp(p, 0.0, 1.0)).r;
  return mix(a, b, uMix);
}

float hash12(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  float h = hash12(uv);
  vHash = h;
  float jx = (h - 0.5) * uTexel.x * 3.4;
  float jy = (fract(h * 17.3) - 0.5) * uTexel.y * 3.4;
  vec2 puv = clamp(uv + vec2(jx, jy), 0.0, 1.0);
  vUv = puv;
  float d = sampleDepth(puv);
  vDepth = d;
  vShell = uShell;
  float life = fract(h * 9.1 + uTime * mix(0.22, 0.04, uFrozen));
  vLife = life;

  float keep = smoothstep(0.12, 0.5, d);
  bool drop = false;
  if (uSpark > 0.5) drop = d < 0.3 || h > 0.72;
  else if (uShell > 0.5) drop = d < 0.42 || h > 0.7;
  else drop = h > keep;

  float breath = sin(uTime * 0.7 + position.x * 9.0 + position.y * 6.0);
  float amp = mix(0.014, 0.002, uFrozen);
  float z = (d - 0.38) * uDepthScale - uShell * (0.03 + 0.05 * d) + breath * amp * (0.35 + d);
  vec3 p = vec3(-position.x, position.y, z);
  if (uSpark > 0.5) p.y += life * 0.2 * (0.35 + d);

  if (drop) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = mix(14.0, 36.0, smoothstep(0.12, 0.9, d));
  size *= mix(0.9, 1.35, uPresence);
  size *= 0.75 + h * 0.45;
  if (uShell > 0.5) size *= 0.42;
  if (uSpark > 0.5) size *= 0.38 + life * 0.55;
  gl_PointSize = size * uPixelRatio * (3.1 / max(0.85, -mv.z));
}
`;

export const particleFragment = /* glsl */ `
uniform sampler2D uVideo;
uniform sampler2D uPaint;
uniform float uOpacity;
uniform float uPresence;
uniform float uTime;
uniform float uSpark;

varying vec2 vUv;
varying float vDepth;
varying float vShell;
varying float vHash;
varying float vLife;

vec3 iridescent(float t) {
  vec3 violet = vec3(0.42, 0.16, 1.0);
  vec3 cyan = vec3(0.05, 0.82, 1.0);
  vec3 magenta = vec3(1.0, 0.18, 0.62);
  vec3 gold = vec3(1.0, 0.78, 0.22);
  float x = fract(t);
  vec3 col = mix(violet, cyan, smoothstep(0.0, 0.38, x));
  col = mix(col, magenta, smoothstep(0.28, 0.7, x));
  col = mix(col, gold, smoothstep(0.62, 1.0, x));
  return col;
}

void main() {
  vec2 pc = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(pc, pc);
  if (r2 > 1.0) discard;
  float disc = exp(-r2 * 2.35);
  float core = exp(-r2 * 12.0);
  float paint = texture2D(uPaint, vUv).r;
  float presence = mix(0.62, 1.55, uPresence);

  if (uSpark > 0.5) {
    vec3 hot = mix(vec3(0.85, 0.12, 0.02), vec3(1.0, 0.86, 0.45), core);
    hot += vec3(1.0, 0.55, 0.15) * paint;
    float alpha = disc * uOpacity * (1.0 - vLife * 0.35);
    gl_FragColor = vec4(hot * presence, alpha);
    return;
  }

  float hue = vDepth * 0.9 + vHash * 0.05 + uTime * 0.02;
  vec3 col = iridescent(hue);
  vec3 vid = texture2D(uVideo, vUv).rgb;
  col = mix(col, col * (0.55 + vid), 0.35);
  col += vec3(0.15, 0.95, 1.0) * paint;
  if (vShell > 0.5) col = mix(col, vec3(0.4, 0.95, 1.0), 0.3);
  col *= presence * mix(1.05, 1.4, smoothstep(0.1, 0.7, vDepth));
  float alpha = smoothstep(1.0, 0.2, r2) * uOpacity;
  if (alpha < 0.04) discard;
  gl_FragColor = vec4(col, alpha);
}
`;

export const meshVertex = /* glsl */ `
uniform sampler2D uDepthA;
uniform sampler2D uDepthB;
uniform float uMix;
uniform float uTime;
uniform float uDepthScale;
uniform float uFrozen;
uniform float uRipple;
uniform vec2 uTexel;

varying vec2 vUv;
varying float vDepth;
varying float vRim;
varying vec2 vGrad;

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
  vGrad = vec2(dx, dy);
  vRim = clamp(length(vGrad) * 3.6, 0.0, 1.0);
  vDepth = d;
  float breath = sin(uTime * 0.5 + position.y * 4.0) * mix(0.008, 0.0, uFrozen);
  float ripple = sin(uv.x * 30.0 + uTime * 1.35) * sin(uv.y * 22.0 - uTime * 0.9);
  ripple *= 0.014 * uRipple * (1.0 - uFrozen) * smoothstep(0.08, 0.45, d);
  vec3 p = vec3(-position.x, position.y, (d - 0.38) * uDepthScale + breath + ripple);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

export const meshFragment = /* glsl */ `
uniform sampler2D uVideo;
uniform sampler2D uPaint;
uniform float uOpacity;
uniform float uPresence;
uniform float uTime;
uniform float uKind;
uniform vec2 uTexel;

varying vec2 vUv;
varying float vDepth;
varying float vRim;
varying vec2 vGrad;

float edgeFade(vec2 uv) {
  float edge = smoothstep(0.0, 0.035, uv.x) * smoothstep(0.0, 0.035, 1.0 - uv.x);
  edge *= smoothstep(0.0, 0.05, uv.y) * smoothstep(0.0, 0.05, 1.0 - uv.y);
  return edge;
}

vec3 particleHue(float t) {
  vec3 violet = vec3(0.45, 0.15, 1.0);
  vec3 cyan = vec3(0.05, 0.82, 1.0);
  vec3 magenta = vec3(1.0, 0.16, 0.62);
  vec3 gold = vec3(1.0, 0.78, 0.2);
  float x = clamp(t, 0.0, 1.0);
  vec3 col = mix(violet, cyan, smoothstep(0.0, 0.35, x));
  col = mix(col, magenta, smoothstep(0.28, 0.68, x));
  return mix(col, gold, smoothstep(0.58, 1.0, x));
}

void main() {
  float paint = texture2D(uPaint, vUv).r;
  float presence = mix(0.72, 1.45, uPresence);
  float body = smoothstep(0.04, 0.2, vDepth);
  vec2 refr = clamp(vUv + vGrad * (0.04 + 0.06 * vDepth), 0.0, 1.0);
  vec3 vid = texture2D(uVideo, refr).rgb;
  vec3 col = vec3(0.0);
  float alpha = body * uOpacity * edgeFade(vUv);

  if (uKind > 3.5) {
    vec2 grid = vec2(46.0, 28.0);
    vec2 id = floor(vUv * grid);
    float h = fract(sin(dot(id, vec2(127.1, 311.7))) * 43758.5453);
    float keep = smoothstep(0.08, 0.22, vDepth);
    vec2 q = fract(vUv * grid) - 0.5;
    q += (vec2(h, fract(h * 13.1)) - 0.5) * 0.28;
    float r2 = dot(q, q) * 3.2;
    if (vDepth < 0.07 || h > keep || r2 > 1.0) discard;
    float cover = smoothstep(1.0, 0.55, r2);
    if (cover < 0.04) discard;
    vec3 tint = particleHue(smoothstep(0.1, 0.42, vDepth));
    vec3 vid = texture2D(uVideo, vUv).rgb;
    tint = mix(tint, tint * (0.6 + vid), 0.22);
    tint += vec3(0.3, 1.0, 1.0) * paint * 0.55;
    tint *= mix(0.94, 1.1, uPresence);
    gl_FragColor = vec4(tint, cover);
    return;
  }

  if (uKind < 0.5) {
    float fres = pow(clamp(vRim, 0.0, 1.0), 0.65);
    float scan = 0.7 + 0.3 * sin(vUv.y * 480.0 + uTime * 1.7);
    vec3 tint = mix(vec3(0.1, 0.75, 1.0), vec3(1.0, 0.2, 0.7), vUv.y * 0.65 + vDepth * 0.35);
    tint = mix(tint, vec3(0.6, 1.0, 0.75), paint);
    col = tint * (0.7 + vDepth * 0.6) + vid * 0.25;
    col += vec3(0.45, 0.95, 1.0) * fres * 1.35;
    col += vec3(1.0, 0.35, 0.75) * fres * vDepth;
    col += vec3(0.5, 1.0, 1.0) * paint;
    col *= scan * presence * 1.25;
    alpha *= 0.78 + fres * 0.22;
  } else if (uKind < 1.5) {
    vec3 n = normalize(vec3(-vGrad.x * 5.0, -vGrad.y * 5.0, 1.0));
    vec3 light = normalize(vec3(0.32, 0.62, 0.72));
    vec3 light2 = normalize(vec3(-0.7, 0.15, 0.68));
    float ndl = clamp(dot(n, light), 0.0, 1.0);
    float spec = pow(ndl, 18.0);
    float spec2 = pow(clamp(dot(n, light2), 0.0, 1.0), 36.0);
    float fres = pow(1.0 - clamp(n.z, 0.0, 1.0), 1.6);
    vec3 oil = mix(vec3(1.0, 0.72, 0.32), vec3(0.25, 0.7, 1.0), vDepth + paint * 0.35);
    vec3 base = mix(vec3(0.28, 0.3, 0.34), vec3(0.9, 0.93, 0.96), vDepth);
    base = mix(base, vid, 0.2);
    col = base * (0.9 + ndl * 0.45);
    col += vec3(1.0) * spec * (1.1 + uPresence);
    col += oil * spec2 * 1.2;
    col += oil * fres * 0.95;
    col += oil * paint;
    col *= presence;
    alpha *= 0.96;
  } else if (uKind < 2.5) {
    float bands = abs(fract(vDepth * 16.0 + vUv.y * 1.5 + uTime * 0.04) - 0.5);
    float contour = smoothstep(0.09, 0.0, bands);
    float rim = smoothstep(0.02, 0.28, vRim);
    float line = clamp(max(contour * 1.1, rim), 0.0, 1.0);
    vec3 neon = mix(vec3(1.0, 0.12, 0.7), vec3(0.2, 0.95, 1.0), vUv.y * 0.65 + vDepth * 0.5);
    neon = mix(neon, vec3(0.75, 1.0, 0.4), paint);
    col = neon * (1.6 + uPresence) * presence;
    alpha *= line;
  } else {
    float heat = smoothstep(0.02, 0.75, vDepth);
    col = mix(vec3(0.55, 0.05, 0.0), vec3(1.0, 0.28, 0.0), heat);
    col = mix(col, vec3(1.0, 0.9, 0.45), smoothstep(0.4, 0.92, vDepth));
    col += vec3(1.0, 0.55, 0.12) * paint;
    col += vec3(1.0, 0.45, 0.08) * pow(clamp(vRim, 0.0, 1.0), 1.2) * 0.7;
    float flicker = 0.92 + 0.08 * sin(uTime * 7.0 + vUv.x * 46.0 + vUv.y * 20.0);
    col *= flicker * presence * 1.35;
    alpha *= 0.82;
  }

  if (alpha < 0.012) discard;
  gl_FragColor = vec4(col, alpha);
}
`;

export const trailFragment = /* glsl */ `
uniform sampler2D uPrev;
uniform sampler2D uBeauty;
uniform float uDecay;
varying vec2 vUv;

void main() {
  vec3 prev = texture2D(uPrev, vUv).rgb * uDecay;
  vec3 beauty = texture2D(uBeauty, vUv).rgb;
  gl_FragColor = vec4(max(prev, beauty * 0.72), 1.0);
}
`;

export const presentFragment = /* glsl */ `
uniform sampler2D uBeauty;
uniform sampler2D uTrail;
uniform float uTrailAmt;
uniform float uBloom;
uniform vec2 uTexel;
varying vec2 vUv;

void main() {
  vec3 beauty = texture2D(uBeauty, vUv).rgb;
  vec3 trail = texture2D(uTrail, vUv).rgb;
  vec3 blur = (
    texture2D(uBeauty, vUv + vec2(uTexel.x * 3.0, 0.0)).rgb +
    texture2D(uBeauty, vUv - vec2(uTexel.x * 3.0, 0.0)).rgb +
    texture2D(uBeauty, vUv + vec2(0.0, uTexel.y * 3.0)).rgb +
    texture2D(uBeauty, vUv - vec2(0.0, uTexel.y * 3.0)).rgb
  ) * 0.25;
  vec3 col = beauty + trail * uTrailAmt + blur * uBloom;
  vec2 q = vUv - 0.5;
  col *= 1.0 - dot(q, q) * 0.22;
  col = pow(max(col, 0.0), vec3(0.9));
  gl_FragColor = vec4(col, 1.0);
}
`;

export const blitVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;
