/**
 * useParticleCanvas.js — Data-driven Three.js particle field (Wave 9).
 *
 * Each particle represents a real market entity:
 *   - 5 hero particles = major indices (SPY, QQQ, DIA, IWM, VIX)
 *   - 20 entity particles = top movers / watchlist tickers
 *   - 5 prediction particles = prediction market probabilities
 *   - 10 ambient particles = atmosphere / filler
 *
 * Data-driven behavior:
 *   - Color: green = up, red = down, orange = high volume/volatility
 *   - Size: hero > entity > ambient; volume spike = pulse larger
 *   - Speed: scales with volatility; VIX > 25 = fast/red-shifted
 *   - Clustering: same-sector particles drift toward each other
 *   - Interaction: hover/tap reveals tooltip, click pre-fills search
 *
 * Performance budget: 60fps iPhone 14+, 30fps iPhone SE 2
 */
import { useRef, useEffect, useCallback, useMemo } from 'react';
import * as THREE from 'three';

// ── Constants ───────────────────────────────────────────────────────────────
const BG_COLOR       = 0x080808;
const GLOW_OPACITY   = 0.35;
const BREATHE_SPEED  = 0.0008;
const DRIFT_SPEED    = 0.00015;
const FRUSTUM        = 4;    // camera frustum half-height
const PULSE_DURATION = 2000; // ms for volume-spike pulse
const ANOMALY_COLOR  = new THREE.Color(0xef4444); // pre-allocated for animation loop

// Index mapping for hero particles
const HERO_TICKERS = ['SPY', 'QQQ', 'DIA', 'IWM', 'VIX'];

// Sector color hues (for clustering visual identity)
const SECTOR_HUES = {
  tech: 0.08,       // orange-ish
  finance: 0.6,     // blue
  energy: 0.12,     // amber
  health: 0.35,     // green
  consumer: 0.75,   // purple
  industrial: 0.55, // teal
  crypto: 0.15,     // gold
  default: 0.06,    // particle orange
};

// ── Color helpers ───────────────────────────────────────────────────────────
function changeToColor(changePct, isHero) {
  if (changePct == null || changePct === 0) {
    return new THREE.Color(0xF97316); // default orange
  }
  const absChange = Math.abs(changePct);
  const intensity = Math.min(absChange / 5, 1); // 0→1 for 0→5% move

  if (changePct > 0) {
    // Green: interpolate from orange (neutral) to green (strong up)
    const c = new THREE.Color();
    c.setHSL(0.06 + intensity * 0.27, 0.85, isHero ? 0.55 : 0.35 + intensity * 0.15);
    return c;
  } else {
    // Red: interpolate from orange to red
    const c = new THREE.Color();
    c.setHSL(0.06 - intensity * 0.06, 0.85, isHero ? 0.5 : 0.3 + intensity * 0.1);
    return c;
  }
}

function predictionColor(probability) {
  // Ring fill concept — but for now, color intensity = confidence
  // Green >70%, amber 40-70%, red <40%
  if (probability > 0.7) return new THREE.Color(0x22c55e);
  if (probability > 0.4) return new THREE.Color(0xf59e0b);
  return new THREE.Color(0xef4444);
}

// ── Mood from VIX ───────────────────────────────────────────────────────────
function computeMoodFromData(marketData, fallbackMood) {
  if (!marketData?.stocks) return fallbackMood || 'neutral';
  const vix = marketData.stocks.VIX || marketData.stocks['VIX'];
  if (vix && vix.price) {
    if (vix.price > 30) return 'volatile';
    if (vix.price > 25) return 'bearish';
    if (vix.price < 15) return 'bullish';
  }
  return fallbackMood || 'neutral';
}

const MOODS = {
  neutral:  { speedMul: 1.0, glowMul: 1.0, hueShift: 0 },
  bullish:  { speedMul: 1.3, glowMul: 1.3, hueShift: 0.03 },
  bearish:  { speedMul: 0.7, glowMul: 0.8, hueShift: -0.03 },
  volatile: { speedMul: 2.2, glowMul: 1.6, hueShift: -0.01 },
};

// ── Main hook ───────────────────────────────────────────────────────────────
export default function useParticleCanvas({
  mood = 'neutral',
  particleCount = 40,
  marketData = null,      // { stocks: { SPY: { price, changePct, ... }, ... } }
  predictions = null,     // [{ title, probability, category }]
  onParticleTap = null,   // (particle) => void — for tap-to-ask
  watchlistTickers = [],  // string[] — user's portfolio tickers (prioritized as entities)
  highlightTickers = [],  // string[] — tickers to glow (from search query / AI response)
  anomalyTickers = [],    // string[] — tickers with active anomalies (red ring pulse)
} = {}) {
  const canvasRef    = useRef(null);
  const stateRef     = useRef(null);
  const rafRef       = useRef(null);
  const reducedMotion = useRef(false);
  const mouseRef     = useRef({ x: 0, y: 0, active: false }); // desktop parallax
  const tooltipRef   = useRef(null);  // tooltip DOM element
  const dataRef      = useRef({ marketData, predictions, mood, onParticleTap, watchlistTickers, highlightTickers, anomalyTickers });
  const holdTimerRef = useRef(null);  // for 500ms hold gesture

  // Keep dataRef current without re-initing
  useEffect(() => {
    dataRef.current = { marketData, predictions, mood, onParticleTap, watchlistTickers, highlightTickers, anomalyTickers };
  }, [marketData, predictions, mood, onParticleTap, watchlistTickers, highlightTickers, anomalyTickers]);

  // Effective mood from VIX data
  const effectiveMood = useMemo(
    () => computeMoodFromData(marketData, mood),
    [marketData, mood]
  );

  // ── Build scene ──────────────────────────────────────────────────────────
  const init = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    reducedMotion.current = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const width  = canvas.clientWidth;
    const height = canvas.clientHeight;
    const dpr    = Math.min(window.devicePixelRatio || 1, 2);

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      powerPreference: 'low-power',
    });
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    renderer.setClearColor(BG_COLOR, 0);

    const aspect  = width / height;
    const frustum = 4;
    const camera  = new THREE.OrthographicCamera(
      -frustum * aspect, frustum * aspect,
      frustum, -frustum, 0.1, 100,
    );
    camera.position.z = 10;

    const scene = new THREE.Scene();

    // ── Create particles ─────────────────────────────────────────────────
    const particles = [];
    const geometry  = new THREE.CircleGeometry(1, 24);
    // Ring geometry for prediction particles
    const ringGeo   = new THREE.RingGeometry(0.85, 1.0, 32);

    const stocks      = dataRef.current.marketData?.stocks || {};
    const preds       = dataRef.current.predictions || [];

    // 1) HERO particles — major indices
    for (let i = 0; i < 5; i++) {
      const ticker = HERO_TICKERS[i];
      const data   = stocks[ticker] || {};
      const changePct = data.changePct ?? data.changePercent ?? 0;

      const angle  = (i / 5) * Math.PI * 2 + Math.random() * 0.3;
      const radius = FRUSTUM * (0.2 + Math.random() * 0.6);
      const x = Math.cos(angle) * radius * aspect;
      const y = Math.sin(angle) * radius;

      const baseScale = 0.14 + Math.random() * 0.06;
      const col = changeToColor(changePct, true);

      const material = new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: GLOW_OPACITY * 1.1,
        depthTest: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, 1);
      mesh.scale.setScalar(baseScale);
      scene.add(mesh);

      particles.push({
        mesh, baseScale, baseOpacity: material.opacity,
        dx: (Math.random() - 0.5) * 2,
        dy: (Math.random() - 0.5) * 2,
        phase: Math.random() * Math.PI * 2,
        isHero: true,
        type: 'hero',
        ticker,
        changePct,
        price: data.price || null,
        pulseUntil: 0,
      });
    }

    // 2) ENTITY particles — watchlist-first, then top movers (up to 20)
    const wlSet = new Set((dataRef.current.watchlistTickers || []).map(s => s.toUpperCase()));
    const allEntities = Object.entries(stocks)
      .filter(([sym, d]) => d && d.changePct != null && !HERO_TICKERS.includes(sym));

    // Watchlist tickers first (sorted by |changePct|), then top movers for remaining slots
    const watchlistEntities = allEntities.filter(([sym]) => wlSet.has(sym.toUpperCase()))
      .sort((a, b) => Math.abs(b[1].changePct ?? 0) - Math.abs(a[1].changePct ?? 0));
    const otherEntities = allEntities.filter(([sym]) => !wlSet.has(sym.toUpperCase()))
      .sort((a, b) => Math.abs(b[1].changePct ?? 0) - Math.abs(a[1].changePct ?? 0));
    const entityTickers = [...watchlistEntities, ...otherEntities].slice(0, 20);

    for (let i = 0; i < entityTickers.length; i++) {
      const [ticker, data] = entityTickers[i];
      const changePct = data.changePct ?? data.changePercent ?? 0;

      const angle  = Math.random() * Math.PI * 2;
      const radius = Math.random() * FRUSTUM * 0.9;
      const x = Math.cos(angle) * radius * aspect;
      const y = Math.sin(angle) * radius;

      const baseScale = 0.05 + Math.min(Math.abs(changePct) / 10, 0.06);
      const col = changeToColor(changePct, false);

      const material = new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: GLOW_OPACITY * (0.4 + Math.min(Math.abs(changePct) / 5, 0.4)),
        depthTest: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, 0.5 + Math.random() * 0.3);
      mesh.scale.setScalar(baseScale);
      scene.add(mesh);

      particles.push({
        mesh, baseScale, baseOpacity: material.opacity,
        dx: (Math.random() - 0.5) * 2,
        dy: (Math.random() - 0.5) * 2,
        phase: Math.random() * Math.PI * 2,
        isHero: false,
        type: 'entity',
        ticker,
        changePct,
        price: data.price || null,
        pulseUntil: 0,
      });
    }

    // 3) PREDICTION particles — top prediction markets (up to 5)
    for (let i = 0; i < Math.min(preds.length, 5); i++) {
      const pred = preds[i];
      const prob = pred.probability || 0.5;

      const angle  = Math.random() * Math.PI * 2;
      const radius = FRUSTUM * (0.2 + Math.random() * 0.7);
      const x = Math.cos(angle) * radius * aspect;
      const y = Math.sin(angle) * radius;

      const baseScale = 0.07 + prob * 0.04;
      const col = predictionColor(prob);

      // Core particle
      const material = new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: GLOW_OPACITY * 0.7,
        depthTest: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, 0.7);
      mesh.scale.setScalar(baseScale);
      scene.add(mesh);

      // Ring around prediction particle (probability fill)
      const ringMat = new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: 0.25,
        depthTest: false,
        side: THREE.DoubleSide,
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.position.set(x, y, 0.71);
      ringMesh.scale.setScalar(baseScale * 1.6);
      scene.add(ringMesh);

      particles.push({
        mesh, baseScale, baseOpacity: material.opacity,
        dx: (Math.random() - 0.5) * 1.5,
        dy: (Math.random() - 0.5) * 1.5,
        phase: Math.random() * Math.PI * 2,
        isHero: false,
        type: 'prediction',
        title: pred.title,
        probability: prob,
        category: pred.category,
        ringMesh,
        pulseUntil: 0,
      });
    }

    // 4) AMBIENT particles — filler for atmosphere
    const ambientCount = Math.max(particleCount - particles.length, 5);
    for (let i = 0; i < ambientCount; i++) {
      const angle  = Math.random() * Math.PI * 2;
      const radius = Math.random() * FRUSTUM * (0.3 + Math.random() * 0.7);
      const x = Math.cos(angle) * radius * aspect;
      const y = Math.sin(angle) * radius;
      const baseScale = 0.02 + Math.random() * 0.04;

      const col = new THREE.Color(0xF97316).multiplyScalar(0.3 + Math.random() * 0.3);
      const material = new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: GLOW_OPACITY * (0.15 + Math.random() * 0.2),
        depthTest: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, Math.random() * 0.3);
      mesh.scale.setScalar(baseScale);
      scene.add(mesh);

      particles.push({
        mesh, baseScale, baseOpacity: material.opacity,
        dx: (Math.random() - 0.5) * 2,
        dy: (Math.random() - 0.5) * 2,
        phase: Math.random() * Math.PI * 2,
        isHero: false,
        type: 'ambient',
        pulseUntil: 0,
      });
    }

    // Centre glow
    const glowGeo  = new THREE.PlaneGeometry(6 * aspect, 6);
    const glowMat  = new THREE.MeshBasicMaterial({
      color: 0xF97316,
      transparent: true,
      opacity: 0.03,
      depthTest: false,
    });
    const glowMesh = new THREE.Mesh(glowGeo, glowMat);
    glowMesh.position.z = -1;
    scene.add(glowMesh);

    // Raycaster for interaction
    const raycaster = new THREE.Raycaster();

    // ── FEATURE 1: Connection lines between nearby particles ────────────────
    // Pre-allocate buffer for 50 lines (100 vertices, 300 floats)
    const linePositions = new Float32Array(300);
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    lineGeometry.setDrawRange(0, 0); // Start with 0 lines visible

    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0xF97316,
      transparent: true,
      opacity: 0.15,
      depthTest: false,
    });
    const lineMesh = new THREE.LineSegments(lineGeometry, lineMaterial);
    scene.add(lineMesh);

    stateRef.current = {
      renderer, camera, scene, particles, glowMesh,
      width, height, aspect, raycaster, geometry, ringGeo,
      lineGeometry, lineMesh, linePositions,
    };
  }, [particleCount]);

  // ── Animation loop ────────────────────────────────────────────────────────
  const animate = useCallback(() => {
    const state = stateRef.current;
    if (!state) return;

    const { renderer, camera, scene, particles, glowMesh, aspect } = state;
    let lastTime = performance.now();

    const loop = (now) => {
      rafRef.current = requestAnimationFrame(loop);
      const dt = Math.min(now - lastTime, 50);
      lastTime = now;

      const currentMood = computeMoodFromData(dataRef.current.marketData, dataRef.current.mood);
      const moodCfg = MOODS[currentMood] || MOODS.neutral;

      if (reducedMotion.current) {
        renderer.render(scene, camera);
        return;
      }

      const driftScale = DRIFT_SPEED * dt * moodCfg.speedMul;
      const breatheT   = now * BREATHE_SPEED;

      // Build sets for highlight and anomaly tickers (from dataRef)
      const highlightSet = new Set((dataRef.current.highlightTickers || []).map(s => s.toUpperCase()));
      const anomalySet = new Set((dataRef.current.anomalyTickers || []).map(s => s.toUpperCase()));

      // Desktop parallax offset
      const px = mouseRef.current.active ? mouseRef.current.x * 0.15 : 0;
      const py = mouseRef.current.active ? mouseRef.current.y * 0.15 : 0;

      for (const p of particles) {
        // Drift + parallax repel (desktop)
        let vx = p.dx * driftScale;
        let vy = p.dy * driftScale;

        if (mouseRef.current.active && p.isHero) {
          // Hero particles gently repel from cursor
          const distX = p.mesh.position.x - px;
          const distY = p.mesh.position.y - py;
          const dist  = Math.sqrt(distX * distX + distY * distY);
          if (dist < 2 && dist > 0.01) {
            const repel = (2 - dist) * 0.0003 * dt;
            vx += (distX / dist) * repel;
            vy += (distY / dist) * repel;
          }
        }

        p.mesh.position.x += vx;
        p.mesh.position.y += vy;

        // Keep ring synced for prediction particles
        if (p.ringMesh) {
          p.ringMesh.position.x = p.mesh.position.x;
          p.ringMesh.position.y = p.mesh.position.y;
        }

        // Wrap edges (use full camera frustum so particles fill the screen)
        const mx = (FRUSTUM + 0.5) * aspect;
        const my = FRUSTUM + 0.5;
        if (p.mesh.position.x > mx) p.mesh.position.x = -mx;
        if (p.mesh.position.x < -mx) p.mesh.position.x = mx;
        if (p.mesh.position.y > my) p.mesh.position.y = -my;
        if (p.mesh.position.y < -my) p.mesh.position.y = my;

        // Breathe
        const breathe = Math.sin(breatheT + p.phase) * 0.5 + 0.5;
        let scaleFactor = 1 + breathe * 0.15;

        // Volume-spike pulse
        if (p.pulseUntil > now) {
          const pulseProgress = (p.pulseUntil - now) / PULSE_DURATION;
          scaleFactor *= 1 + pulseProgress * 0.4;
        }

        // Search highlight: matched tickers glow brighter + pulse faster
        const isHighlighted = p.ticker && highlightSet.has(p.ticker.toUpperCase());
        if (isHighlighted) {
          scaleFactor *= 1.3 + Math.sin(now * 0.004) * 0.15; // faster pulse
        }

        // Anomaly disturbance: particles with active anomalies get red-shifted + jitter
        const hasAnomaly = p.ticker && anomalySet.has(p.ticker.toUpperCase());
        if (hasAnomaly) {
          // Red-shift the color (use pre-allocated color to avoid GC)
          p.mesh.material.color.lerp(ANOMALY_COLOR, 0.3);
          // Jitter position
          p.mesh.position.x += (Math.random() - 0.5) * 0.003 * dt;
          p.mesh.position.y += (Math.random() - 0.5) * 0.003 * dt;
          scaleFactor *= 1.15;
        }

        p.mesh.scale.setScalar(p.baseScale * scaleFactor);
        const opacityBoost = isHighlighted ? 1.5 : (hasAnomaly ? 1.3 : 1.0);
        p.mesh.material.opacity = p.baseOpacity * (0.7 + breathe * 0.3) * moodCfg.glowMul * opacityBoost;

        // Ring opacity breathes too
        if (p.ringMesh) {
          p.ringMesh.scale.setScalar(p.baseScale * scaleFactor * 1.6);
          p.ringMesh.material.opacity = 0.18 + breathe * 0.1;
        }
      }

      // Centre glow
      glowMesh.material.opacity = 0.02 + Math.sin(breatheT * 0.7) * 0.01 * moodCfg.glowMul;

      // ── FEATURE 1: Update connection lines ────────────────────────────
      const nonAmbientParticles = particles.filter(p => p.type !== 'ambient');
      const MAX_LINES = 50;
      const DISTANCE_THRESHOLD = 2.5;
      let lineCount = 0;
      const posArray = state.linePositions;

      for (let i = 0; i < nonAmbientParticles.length && lineCount < MAX_LINES; i++) {
        const p1 = nonAmbientParticles[i];
        for (let j = i + 1; j < nonAmbientParticles.length && lineCount < MAX_LINES; j++) {
          const p2 = nonAmbientParticles[j];

          const dx = p2.mesh.position.x - p1.mesh.position.x;
          const dy = p2.mesh.position.y - p1.mesh.position.y;
          const distSq = dx * dx + dy * dy;
          const dist = Math.sqrt(distSq);

          if (dist < DISTANCE_THRESHOLD) {
            // Fade opacity as distance approaches threshold
            const opacity = 0.15 * (1 - dist / DISTANCE_THRESHOLD);

            // Write line start and end positions to buffer
            const idx = lineCount * 6; // Each line = 2 vertices, each vertex = 3 floats
            posArray[idx]     = p1.mesh.position.x;
            posArray[idx + 1] = p1.mesh.position.y;
            posArray[idx + 2] = p1.mesh.position.z;
            posArray[idx + 3] = p2.mesh.position.x;
            posArray[idx + 4] = p2.mesh.position.y;
            posArray[idx + 5] = p2.mesh.position.z;

            lineCount++;
          }
        }
      }

      state.lineGeometry.attributes.position.needsUpdate = true;
      state.lineGeometry.setDrawRange(0, lineCount * 2); // lineCount * 2 vertices
      state.lineMesh.material.opacity = 0.15;

      renderer.render(scene, camera);
    };

    rafRef.current = requestAnimationFrame(loop);
  }, []);

  // ── Update particles when data changes (without re-init) ──────────────────
  useEffect(() => {
    const state = stateRef.current;
    if (!state || !marketData) return;

    const stocks = marketData.stocks || {};

    for (const p of state.particles) {
      if (p.type === 'hero' || p.type === 'entity') {
        const data = stocks[p.ticker];
        if (!data) continue;

        const newChange = data.changePct ?? data.changePercent ?? 0;
        const col = changeToColor(newChange, p.isHero);
        p.mesh.material.color.copy(col);
        p.changePct = newChange;
        p.price = data.price;

        // Pulse on big moves (>3% change since last update)
        if (Math.abs(newChange) > 3 && Math.abs(newChange - (p._lastChange || 0)) > 0.5) {
          p.pulseUntil = performance.now() + PULSE_DURATION;
        }
        p._lastChange = newChange;
      }
    }
  }, [marketData]);

  // ── Update predictions ────────────────────────────────────────────────────
  useEffect(() => {
    const state = stateRef.current;
    if (!state || !predictions) return;

    const predParticles = state.particles.filter(p => p.type === 'prediction');
    for (let i = 0; i < predParticles.length && i < predictions.length; i++) {
      const p    = predParticles[i];
      const pred = predictions[i];
      const prob = pred.probability || 0.5;
      const col  = predictionColor(prob);

      p.mesh.material.color.copy(col);
      if (p.ringMesh) p.ringMesh.material.color.copy(col);
      p.probability = prob;
      p.title = pred.title;
    }
  }, [predictions]);

  // ── Mouse interaction (desktop parallax + hover) ──────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function onMouseMove(e) {
      const rect = canvas.getBoundingClientRect();
      // Normalize to -1 → +1
      mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      mouseRef.current.active = true;
    }

    function onMouseLeave() {
      mouseRef.current.active = false;
    }

    function onClick(e) {
      const state = stateRef.current;
      if (!state) return;

      const rect = canvas.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );

      state.raycaster.setFromCamera(pointer, state.camera);
      const intersects = state.raycaster.intersectObjects(
        state.particles.filter(p => p.type !== 'ambient').map(p => p.mesh),
      );

      if (intersects.length > 0) {
        const hitMesh = intersects[0].object;
        const hitP = state.particles.find(p => p.mesh === hitMesh);
        if (hitP && dataRef.current.onParticleTap) {
          dataRef.current.onParticleTap(hitP);
        }
      }
    }

    // ── FEATURE 2: Hold gesture (500ms) ──────────────────────────────────
    let holdTouchX = 0;
    let holdTouchY = 0;

    function onTouchStart(e) {
      if (e.touches.length === 0) return;
      const touch = e.touches[0];
      holdTouchX = touch.clientX;
      holdTouchY = touch.clientY;

      // Start 500ms hold timer
      holdTimerRef.current = setTimeout(() => {
        const state = stateRef.current;
        if (!state) return;

        const rect = canvas.getBoundingClientRect();
        const pointer = new THREE.Vector2(
          ((holdTouchX - rect.left) / rect.width) * 2 - 1,
          -((holdTouchY - rect.top) / rect.height) * 2 + 1,
        );

        state.raycaster.setFromCamera(pointer, state.camera);
        const intersects = state.raycaster.intersectObjects(
          state.particles.filter(p => p.type !== 'ambient').map(p => p.mesh),
        );

        if (intersects.length > 0) {
          const hitMesh = intersects[0].object;
          const hitP = state.particles.find(p => p.mesh === hitMesh);
          if (hitP && hitP.ticker) {
            // Dispatch custom event with particle data
            const event = new CustomEvent('particle-hold', {
              detail: {
                ticker: hitP.ticker,
                type: hitP.type,
                changePct: hitP.changePct,
                price: hitP.price,
              },
            });
            canvas.dispatchEvent(event);
          }
        }
      }, 500);
    }

    function onTouchMove(e) {
      if (e.touches.length === 0) return;
      const touch = e.touches[0];
      const dx = touch.clientX - holdTouchX;
      const dy = touch.clientY - holdTouchY;
      const moveDistance = Math.sqrt(dx * dx + dy * dy);

      // Cancel hold if moved >10px (it's a scroll)
      if (moveDistance > 10) {
        if (holdTimerRef.current) {
          clearTimeout(holdTimerRef.current);
          holdTimerRef.current = null;
        }
      }
    }

    function onTouchEnd(e) {
      // Cancel hold timer on touch end
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }

      // Also handle tap (quick release)
      if (e.changedTouches.length === 0) return;
      const touch = e.changedTouches[0];
      onClick({ clientX: touch.clientX, clientY: touch.clientY });
    }

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseleave', onMouseLeave);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('touchstart', onTouchStart);
    canvas.addEventListener('touchmove', onTouchMove);
    canvas.addEventListener('touchend', onTouchEnd);

    return () => {
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  // ── Resize ────────────────────────────────────────────────────────────────
  const handleResize = useCallback(() => {
    const state  = stateRef.current;
    const canvas = canvasRef.current;
    if (!state || !canvas) return;

    const width  = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === state.width && height === state.height) return;

    const aspect  = width / height;
    const frustum = 4;
    state.camera.left   = -frustum * aspect;
    state.camera.right  = frustum * aspect;
    state.camera.top    = frustum;
    state.camera.bottom = -frustum;
    state.camera.updateProjectionMatrix();

    state.renderer.setSize(width, height, false);
    state.width  = width;
    state.height = height;
    state.aspect = aspect;
  }, []);

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  useEffect(() => {
    init();
    animate();

    const ro = new ResizeObserver(handleResize);
    if (canvasRef.current) ro.observe(canvasRef.current);

    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const onMotionChange = (e) => { reducedMotion.current = e.matches; };
    mq?.addEventListener?.('change', onMotionChange);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      mq?.removeEventListener?.('change', onMotionChange);

      const state = stateRef.current;
      if (state) {
        state.particles.forEach(p => {
          p.mesh.geometry.dispose();
          p.mesh.material.dispose();
          if (p.ringMesh) {
            p.ringMesh.geometry.dispose();
            p.ringMesh.material.dispose();
          }
        });
        state.glowMesh.geometry.dispose();
        state.glowMesh.material.dispose();
        state.geometry.dispose();
        state.ringGeo.dispose();
        state.lineGeometry.dispose();
        state.lineMesh.material.dispose();
        state.renderer.dispose();
        stateRef.current = null;
      }
    };
  }, [init, animate, handleResize]);

  return canvasRef;
}
