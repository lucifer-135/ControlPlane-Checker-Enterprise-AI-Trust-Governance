/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef } from 'react';

export const AmbientShaderBackground: React.FC = React.memo(() => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let animFrameId: number;

    const gl = canvas.getContext('webgl') || (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);
    if (!gl) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Render at device resolution (capped at 2x) so the dither pattern lands on
    // real pixels instead of being upscaled into visible 2x2 blocks.
    const syncSize = () => {
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.floor(window.innerWidth * dpr);
      const h = Math.floor(window.innerHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };

    window.addEventListener('resize', syncSize);
    syncSize();

    const vsSource = `
      attribute vec2 a_position;
      varying vec2 v_texCoord;
      void main() {
        v_texCoord = a_position * 0.5 + 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;

    // Rich, sophisticated multi-chromatic ambient wash:
    // Creates subtle, luminous color fields (indigo, cyan, periwinkle, lavender, slate)
    // that give frosted glass panels authentic optical refraction and depth.
    const fsSource = `
      #ifdef GL_FRAGMENT_PRECISION_HIGH
      precision highp float;
      #else
      precision mediump float;
      #endif

      varying vec2 v_texCoord;
      uniform float u_time;
      uniform vec2 u_resolution;

      // Stable per-pixel hash for fine grain dither
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
      }

      // Aspect-corrected gaussian field
      float field(vec2 uv, vec2 c, float k, float aspect) {
        vec2 d = uv - c;
        d.x *= aspect;
        return exp(-dot(d, d) * k);
      }

      void main() {
        vec2 uv = v_texCoord;
        float aspect = u_resolution.x / max(u_resolution.y, 1.0);

        float t = u_time * 0.04;

        // Clean cool foundational slate (#EFF3F8)
        vec3 base = vec3(0.937, 0.953, 0.973);

        // Luminous chromatic fields calibrated for light frosted glass refraction
        vec3 tintIndigo      = vec3(0.875, 0.902, 0.985); // Indigo / periwinkle glow
        vec3 tintCyanSoft    = vec3(0.860, 0.935, 0.980); // Luminous cyan / ice blue
        vec3 tintVioletMist  = vec3(0.910, 0.895, 0.975); // Soft lavender / violet
        vec3 tintEmeraldWash = vec3(0.880, 0.960, 0.930); // Soft mint / emerald whisper
        vec3 tintAmberGlow   = vec3(0.980, 0.930, 0.885); // Subtle warm accent

        // 1. Indigo / Periwinkle orb, drifting upper right
        vec2 c1 = vec2(0.80 + sin(t * 0.45) * 0.12, 0.82 + cos(t * 0.35) * 0.10);
        float w1 = field(uv, c1, 0.85, aspect) * (0.85 + sin(t * 0.50) * 0.08);

        // 2. Cyan / Ice-Blue field, lower left
        vec2 c2 = vec2(0.18 - cos(t * 0.40) * 0.10, 0.22 + sin(t * 0.35) * 0.08);
        float w2 = field(uv, c2, 0.95, aspect) * (0.80 + cos(t * 0.45) * 0.06);

        // 3. Lavender / Violet field, center-top navigation aura
        vec2 c3 = vec2(0.52 + sin(t * 0.30) * 0.14, 0.96 + cos(t * 0.25) * 0.05);
        float w3 = field(uv, c3, 0.70, aspect) * (0.75 + sin(t * 0.30) * 0.05);

        // 4. Soft mint / emerald whisper, lower right
        vec2 c4 = vec2(0.85 + cos(t * 0.38) * 0.08, 0.18 + sin(t * 0.42) * 0.07);
        float w4 = field(uv, c4, 1.20, aspect) * 0.55;

        // 5. Subtle warm amber whisper, mid-left
        vec2 c5 = vec2(0.08 + sin(t * 0.28) * 0.06, 0.65 - cos(t * 0.32) * 0.08);
        float w5 = field(uv, c5, 1.30, aspect) * 0.45;

        // Composite smooth chromatic glass refraction backdrops
        vec3 col = base;
        col = mix(col, tintIndigo, clamp(w1, 0.0, 1.0));
        col = mix(col, tintCyanSoft, clamp(w2, 0.0, 1.0));
        col = mix(col, tintVioletMist, clamp(w3, 0.0, 1.0));
        col = mix(col, tintEmeraldWash, clamp(w4, 0.0, 1.0));
        col = mix(col, tintAmberGlow, clamp(w5, 0.0, 1.0));

        // Ultra-fine micro-dither to prevent color banding on 8-bit displays
        col += (hash(gl_FragCoord.xy) - 0.5) * (1.1 / 255.0);

        gl_FragColor = vec4(col, 1.0);
      }
    `;

    const createShader = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.warn('Shader compile failed:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vs = createShader(gl.VERTEX_SHADER, vsSource);
    const fs = createShader(gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('Program link failed:', gl.getProgramInfoLog(program));
      return;
    }

    gl.useProgram(program);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );

    const posAttr = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(posAttr);
    gl.vertexAttribPointer(posAttr, 2, gl.FLOAT, false, 0, 0);

    const uTimeLoc = gl.getUniformLocation(program, 'u_time');
    const uResLoc = gl.getUniformLocation(program, 'u_resolution');

    let startTime = performance.now();

    // Under reduced-motion, render a single static frame and stop.
    if (prefersReducedMotion) {
      gl.uniform1f(uTimeLoc, 8.0);
      gl.uniform2f(uResLoc, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      return () => {
        window.removeEventListener('resize', syncSize);
      };
    }

    const FRAME_MS = 1000 / 30;
    let lastDraw = 0;

    const render = (time: number) => {
      animFrameId = requestAnimationFrame(render);
      if (time - lastDraw < FRAME_MS) return;
      lastDraw = time;

      const elapsed = (time - startTime) * 0.001;
      gl.uniform1f(uTimeLoc, elapsed);
      gl.uniform2f(uResLoc, canvas.width, canvas.height);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };

    animFrameId = requestAnimationFrame(render);

    return () => {
      window.removeEventListener('resize', syncSize);
      cancelAnimationFrame(animFrameId);
    };
  }, []);

  return (
    <>
      {/* 1. Subtle Multi-Chromatic WebGL Ambient Canvas */}
      <canvas
        ref={canvasRef}
        className="fixed inset-0 w-full h-full pointer-events-none -z-30"
        aria-hidden="true"
      />

      {/* 2. Soft Atmospheric Glow Orbs for Dynamic Depth */}
      <div
        className="fixed -top-32 right-1/4 w-96 h-96 bg-indigo-400/10 rounded-full blur-3xl pointer-events-none -z-20"
        aria-hidden="true"
      />
      <div
        className="fixed top-1/3 -left-20 w-80 h-80 bg-cyan-400/10 rounded-full blur-3xl pointer-events-none -z-20"
        aria-hidden="true"
      />
      <div
        className="fixed bottom-10 right-10 w-96 h-96 bg-purple-400/8 rounded-full blur-3xl pointer-events-none -z-20"
        aria-hidden="true"
      />

      {/* 3. Subtle Precision Telemetry Grid Pattern */}
      <div
        className="fixed inset-0 w-full h-full pointer-events-none -z-10 bg-[radial-gradient(#94A3B8_1px,transparent_1px)] [background-size:28px_28px] opacity-[0.06] [mask-image:radial-gradient(ellipse_80%_80%_at_50%_40%,#000_60%,transparent_100%)]"
        aria-hidden="true"
      />
    </>
  );
});
