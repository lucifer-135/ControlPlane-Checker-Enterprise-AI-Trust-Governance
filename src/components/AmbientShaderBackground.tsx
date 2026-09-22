/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

/**
 * AmbientShaderBackground
 *
 * Hardware-accelerated, pure-CSS multi-chromatic ambient mesh.
 * Replaces heavy WebGL canvas requestAnimationFrame rendering loops to eliminate
 * Chromium GPU compositor tile collisions with CSS backdrop-filter (the "white box" bug),
 * while preserving rich optical refraction depth for frosted glass surfaces.
 */
export const AmbientShaderBackground: React.FC = React.memo(() => {
  return (
    <div
      className="fixed inset-0 w-full h-full pointer-events-none overflow-hidden -z-30"
      aria-hidden="true"
    >
      {/* Foundational Cool Slate Canvas */}
      <div className="absolute inset-0 bg-[#EEF2F6]" />

      {/* 1. Luminous Indigo / Periwinkle Aura - Upper Right */}
      <div
        className="absolute -top-[15%] right-[5%] w-[600px] h-[600px] rounded-full bg-gradient-to-br from-indigo-300/30 via-indigo-400/20 to-purple-400/15 blur-[100px] animate-ambient-drift-1"
        style={{ transform: 'translate3d(0, 0, 0)' }}
      />

      {/* 2. Soft Cyan / Ice-Blue Field - Lower Left */}
      <div
        className="absolute top-[35%] -left-[10%] w-[550px] h-[550px] rounded-full bg-gradient-to-tr from-cyan-300/25 via-sky-300/20 to-indigo-200/15 blur-[90px] animate-ambient-drift-2"
        style={{ transform: 'translate3d(0, 0, 0)' }}
      />

      {/* 3. Soft Lavender / Violet Navigation Aura - Center Top */}
      <div
        className="absolute -top-[10%] left-[30%] w-[500px] h-[400px] rounded-full bg-gradient-to-b from-purple-300/20 via-violet-300/15 to-transparent blur-[85px] animate-ambient-drift-3"
        style={{ transform: 'translate3d(0, 0, 0)' }}
      />

      {/* 4. Soft Mint / Emerald Whisper - Lower Right */}
      <div
        className="absolute bottom-[5%] right-[10%] w-[450px] h-[450px] rounded-full bg-gradient-to-tl from-emerald-300/20 via-teal-200/15 to-sky-200/10 blur-[80px] animate-ambient-drift-4"
        style={{ transform: 'translate3d(0, 0, 0)' }}
      />

      {/* 5. Subtle Warm Amber Whisper - Mid Left */}
      <div
        className="absolute top-[60%] left-[10%] w-[380px] h-[380px] rounded-full bg-gradient-to-r from-amber-200/15 via-orange-200/10 to-transparent blur-[75px] animate-ambient-drift-5"
        style={{ transform: 'translate3d(0, 0, 0)' }}
      />

      {/* 6. Subtle Precision Telemetry Grid Pattern with Radial Vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(#94A3B8_1px,transparent_1px)] [background-size:28px_28px] opacity-[0.06] [mask-image:radial-gradient(ellipse_80%_80%_at_50%_40%,#000_60%,transparent_100%)]" />
    </div>
  );
});
