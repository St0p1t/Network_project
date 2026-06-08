/**
 * Raw WebGL background renderer — same GLSL flow-field shader as the JS version.
 * Returns { draw(audio, time), resize(w, h) } or null if WebGL unavailable.
 */

// ─── Shaders ─────────────────────────────────────────────────────────────────

const VS = `
attribute vec2 aPos;
varying vec2 vUv;
void main(){
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const NOISE_GLSL = `
vec3 _p(vec3 x){return mod(((x*34.0)+1.0)*x,289.0);}
float snoise(vec2 v){
  const vec4 C=vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);
  vec2 i=floor(v+dot(v,C.yy));
  vec2 x0=v-i+dot(i,C.xx);
  vec2 i1=(x0.x>x0.y)?vec2(1.,0.):vec2(0.,1.);
  vec4 x12=x0.xyxy+C.xxzz;
  x12.xy-=i1;
  i=mod(i,289.0);
  vec3 p=_p(_p(i.y+vec3(0.,i1.y,1.))+i.x+vec3(0.,i1.x,1.));
  vec3 m=max(0.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.);
  m=m*m;m=m*m;
  vec3 x=2.*fract(p*C.www)-1.;
  vec3 h=abs(x)-.5;
  vec3 ox=floor(x+.5);
  vec3 a0=x-ox;
  m*=1.79284291400159-.85373472095314*(a0*a0+h*h);
  vec3 g;
  g.x=a0.x*x0.x+h.x*x0.y;
  g.yz=a0.yz*x12.xz+h.yz*x12.yw;
  return 130.*dot(m,g);
}`;

const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
#else
  precision mediump float;
#endif
uniform float time, rms, bass, mid, high, pitch, silence, onset;
varying vec2 vUv;
${NOISE_GLSL}
void main(){
  vec2 p = vUv - 0.5;
  float speed = 0.12 + rms * 0.7;
  float t = time;

  float n1 = snoise(p * 2.2 + vec2(t*speed*0.4,  t*speed*0.3));
  float n2 = snoise(p * 4.1 - vec2(t*speed*0.22, t*speed*0.38) + 5.7);
  float n3 = snoise(p * 7.5 + vec2(n1*0.4+bass*0.6, n2*0.3+t*speed*0.12));
  float n4 = snoise(p * 14. + vec2(t*1.1+n3, t*0.9));
  float noise = n1*.48 + n2*.29 + n3*.15 + n4*.08;

  float p01 = clamp(pitch*2.0,     0., 1.);
  float p12 = clamp(pitch*2.0-1.0, 0., 1.);
  vec3 cLow  = vec3(0.06,0.01,0.14);
  vec3 cMid  = vec3(0.03,0.07,0.20);
  vec3 cHigh = vec3(0.00,0.18,0.28);
  vec3 base  = mix(mix(cLow,cMid,p01), cHigh, p12);

  vec3 nHue  = mix(vec3(0.20,0.04,0.30), vec3(0.00,0.28,0.42), pitch);
  vec3 color = base + nHue * (noise*0.45+0.3) * 0.18;

  vec3 gHue  = mix(vec3(0.55,0.08,0.02), vec3(0.00,0.38,0.80), pitch);
  color += gHue * pow(rms, 1.4) * 2.2;

  float dist  = length(p);
  float bWave = sin(dist*7.0 - time*3.8 + bass*9.0)*0.5 + 0.5;
  color += vec3(0.18,0.02,0.38) * bWave * bass * 0.45 * max(0., 1.-dist*2.2);

  float spk = snoise(p*18. + vec2(time*2.6, time*3.3));
  spk = pow(max(0., spk), 2.8);
  color += vec3(0.55,0.85,1.) * spk * high * 0.55;

  float rib = snoise(p*5. + vec2(n1*2., time*0.6))*0.5 + 0.5;
  color += vec3(0.10,0.40,0.60) * rib * mid * 0.25;

  color += vec3(0.3,0.5,1.) * onset * 0.4;

  color = mix(color, vec3(0.008,0.012,0.025), silence*0.65);

  float vig = 1. - smoothstep(0.25, 0.85, dist*1.9);
  color *= 0.65 + vig*0.35;

  color = color / (color + 0.8);
  color = pow(color, vec3(0.88));

  gl_FragColor = vec4(color, 1.0);
}`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function link(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(p));
  return p;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function initEnvGL(canvas) {
  const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  if (!gl) return null;

  let prog;
  try {
    prog = link(gl, compile(gl, gl.VERTEX_SHADER, VS), compile(gl, gl.FRAGMENT_SHADER, FS));
  } catch (e) {
    console.error('EnvGL shader error:', e);
    return null;
  }

  // Fullscreen quad
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1,-1,  1,-1, -1, 1,
     1,-1,  1, 1, -1, 1,
  ]), gl.STATIC_DRAW);

  const aPos = gl.getAttribLocation(prog, 'aPos');

  // Uniform locations
  const U = {};
  for (const name of ['time','rms','bass','mid','high','pitch','silence','onset'])
    U[name] = gl.getUniformLocation(prog, name);

  return {
    draw(audio, time) {
      const w = canvas.width, h = canvas.height;
      gl.viewport(0, 0, w, h);
      gl.useProgram(prog);

      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

      gl.uniform1f(U.time,    time);
      gl.uniform1f(U.rms,     audio.rms     || 0);
      gl.uniform1f(U.bass,    audio.bass    || 0);
      gl.uniform1f(U.mid,     audio.mid     || 0);
      gl.uniform1f(U.high,    audio.high    || 0);
      gl.uniform1f(U.pitch,   audio.pitch   ?? 0.5);
      gl.uniform1f(U.silence, audio.silence || 0);
      gl.uniform1f(U.onset,   audio.onset   || 0);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },

    resize(w, h) {
      canvas.width  = w;
      canvas.height = h;
    },
  };
}
