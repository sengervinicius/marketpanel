/**
 * useParticleCanvas.js — Three.js particle field for the Particle screen.
 *
 * Renders floating luminous orbs on a dark canvas. Each particle drifts
 * lazily, breathes (scale oscillation), and glows with the Particle orange.
 * Market mood can influence speed, colour temperature, and glow intensity.
 *
 * Performance budget:
 *   - 60 fps on iPhone 14 (A15+)
 *   - 30 fps on iPhone SE 2 (A13)
 *   - Respects prefers-reduced-motion (freezes animation)
 *
 * Usage:
 *   const canvasRef = useParticleCanvas({ mood, particleCount });
 *   <canvas ref={canvasRef} />
 */
import { useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';

// ── Defaults ─────────────────────────────────────────────────────────────────
const DEFAULT_COUNT = 40;
const PARTICLE_COLOR = 0xF97316;      // --color-particle
const PARTICLE_COLOR_VEC = new THREE.Color(PARTICLE_COLOR);
const BG_COLOR = 0x080808;            // --color-bg
const GLOW_OPACITY = 0.35;
const BREATHE_SPEED = 0.0008;         // cycles per ms (~2.4s full cycle)
const DRIFT_SPEED = 0.00015;          // base drift per ms
const MAX_RADIUS = 1.8;               // max spawn distance from center (normalised)

// Mood presets: { speedMul, glowMul, hueShift }
const MOODS = {
  neutral:  { speedMul: 1.0, glowMul: 1.0, hueShift: 0 },
  bullish:  { speedMul: 1.4, glowMul: 1.3, hueShift: 0.03 },   // slightly warmer
  bearish:  { speedMul: 0.6, glowMul: 0.7, hueShift: -0.02 },  // slightly cooler
  volatile: { speedMul: 2.0, glowMul: 1.6, hueShift: 0 },
};

export default function useParticleCanvas({ mood = 'neutral', particleCount = DEFAULT_COUNT } = {}) {
  const canvasRef = useRef(null);
  const stateRef = useRef(null);   // holds Three.js scene graph
  const rafRef = useRef(null);
  const reducedMotion = useRef(false);

  // ── Build scene ────────────────────────────────────────────────────────────
  const init = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Check reduced motion preference
    reducedMotion.current = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2); // cap at 2× for perf

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,        // save GPU cycles on mobile
      powerPreference: 'low-power',
    });
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    renderer.setClearColor(BG_COLOR, 0); // transparent — CSS bg shows through

    // Camera — orthographic for 2D-feeling depth
    const aspect = width / height;
    const frustum = 4;
    const camera = new THREE.OrthographicCamera(
      -frustum * aspect, frustum * aspect,
      frustum, -frustum,
      0.1, 100,
    );
    camera.position.z = 10;

    // Scene
    const scene = new THREE.Scene();

    // ── Create particles ─────────────────────────────────────────────────────
    const particles = [];
    const geometry = new THREE.CircleGeometry(1, 24);

    for (let i = 0; i < particleCount; i++) {
      // Random position in elliptical distribution
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * MAX_RADIUS * (0.3 + Math.random() * 0.7);
      const x = Math.cos(angle) * radius * aspect;
      const y = Math.sin(angle) * radius;

      // Size varies: few large hero particles, many small ambient ones
      const isHero = i < 5;
      const baseScale = isHero
        ? 0.12 + Math.random() * 0.08   // hero: 0.12–0.20
        : 0.03 + Math.random() * 0.05;  // ambient: 0.03–0.08

      // Colour — hero particles are brighter, ambient ones dimmer
      const col = PARTICLE_COLOR_VEC.clone();
      if (!isHero) {
        col.multiplyScalar(0.4 + Math.random() * 0.3); // dim to 40-70%
      }

      const material = new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: isHero ? GLOW_OPACITY : GLOW_OPACITY * (0.3 + Math.random() * 0.4),
        depthTest: false,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, isHero ? 1 : Math.random() * 0.5);
      mesh.scale.setScalar(baseScale);
      scene.add(mesh);

      particles.push({
        mesh,
        baseScale,
        baseOpacity: material.opacity,
        // Drift vector (slow random direction)
        dx: (Math.random() - 0.5) * 2,
        dy: (Math.random() - 0.5) * 2,
        // Phase offset for breathing
        phase: Math.random() * Math.PI * 2,
        isHero,
      });
    }

    // Add a subtle centre glow (additive blended sprite)
    const glowGeo = new THREE.PlaneGeometry(6 * aspect, 6);
    const glowMat = new THREE.MeshBasicMaterial({
      color: PARTICLE_COLOR,
      transparent: true,
      opacity: 0.03,
      depthTest: false,
    });
    const glowMesh = new THREE.Mesh(glowGeo, glowMat);
    glowMesh.position.z = -1;
    scene.add(glowMesh);

    stateRef.current = { renderer, camera, scene, particles, glowMesh, width, height, aspect };
  }, [particleCount]);

  // ── Animation loop ─────────────────────────────────────────────────────────
  const animate = useCallback(() => {
    const state = stateRef.current;
    if (!state) return;

    const { renderer, camera, scene, particles, glowMesh, aspect } = state;
    const moodCfg = MOODS[mood] || MOODS.neutral;
    let lastTime = performance.now();

    const loop = (now) => {
      rafRef.current = requestAnimationFrame(loop);
      const dt = Math.min(now - lastTime, 50); // cap delta to avoid jumps
      lastTime = now;

      if (reducedMotion.current) {
        // Still render once, but don't animate
        renderer.render(scene, camera);
        return;
      }

      const driftScale = DRIFT_SPEED * dt * moodCfg.speedMul;
      const breatheT = now * BREATHE_SPEED;

      for (const p of particles) {
        // Drift
        p.mesh.position.x += p.dx * driftScale;
        p.mesh.position.y += p.dy * driftScale;

        // Wrap around edges with soft margin
        const mx = (MAX_RADIUS + 0.5) * aspect;
        const my = MAX_RADIUS + 0.5;
        if (p.mesh.position.x > mx) p.mesh.position.x = -mx;
        if (p.mesh.position.x < -mx) p.mesh.position.x = mx;
        if (p.mesh.position.y > my) p.mesh.position.y = -my;
        if (p.mesh.position.y < -my) p.mesh.position.y = my;

        // Breathe (scale + opacity oscillation)
        const breathe = Math.sin(breatheT + p.phase) * 0.5 + 0.5; // 0→1
        const scaleFactor = 1 + breathe * 0.15; // ±15%
        p.mesh.scale.setScalar(p.baseScale * scaleFactor);
        p.mesh.material.opacity = p.baseOpacity * (0.7 + breathe * 0.3) * moodCfg.glowMul;
      }

      // Pulse the centre glow
      glowMesh.material.opacity = 0.02 + Math.sin(breatheT * 0.7) * 0.01 * moodCfg.glowMul;

      renderer.render(scene, camera);
    };

    rafRef.current = requestAnimationFrame(loop);
  }, [mood]);

  // ── Resize handler ─────────────────────────────────────────────────────────
  const handleResize = useCallback(() => {
    const state = stateRef.current;
    const canvas = canvasRef.current;
    if (!state || !canvas) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === state.width && height === state.height) return;

    const aspect = width / height;
    const frustum = 4;
    state.camera.left = -frustum * aspect;
    state.camera.right = frustum * aspect;
    state.camera.top = frustum;
    state.camera.bottom = -frustum;
    state.camera.updateProjectionMatrix();

    state.renderer.setSize(width, height, false);
    state.width = width;
    state.height = height;
    state.aspect = aspect;
  }, []);

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  useEffect(() => {
    init();
    animate();

    const ro = new ResizeObserver(handleResize);
    if (canvasRef.current) ro.observe(canvasRef.current);

    // Listen for reduced-motion changes
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const onMotionChange = (e) => { reducedMotion.current = e.matches; };
    mq?.addEventListener?.('change', onMotionChange);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      mq?.removeEventListener?.('change', onMotionChange);

      // Dispose Three.js resources
      const state = stateRef.current;
      if (state) {
        state.particles.forEach(p => {
          p.mesh.geometry.dispose();
          p.mesh.material.dispose();
        });
        state.glowMesh.geometry.dispose();
        state.glowMesh.material.dispose();
        state.renderer.dispose();
        stateRef.current = null;
      }
    };
  }, [init, animate, handleResize]);

  return canvasRef;
}
