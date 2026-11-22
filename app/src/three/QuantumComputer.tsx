/**
 * A procedural dilution refrigerator: the gold "chandelier" that cools a quantum processor to
 * millikelvin. Built from primitives (no external assets), lit by studio light formers.
 * It turns and the camera descends its five temperature stages as the page scrolls; it can be
 * dragged, glints where the pointer is, and sends a light pulse down the stages on click.
 */
import { Environment, Html, Lightformer } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export interface StageSignals {
  progress: MutableRefObject<number>;
  pointer: MutableRefObject<{ x: number; y: number }>;
  dragVelocity: MutableRefObject<number>;
  pulses: MutableRefObject<number[]>;
}

export const PLATES = [
  { y: 3.0, r: 2.05, temp: "50 K", name: "First stage" },
  { y: 1.55, r: 1.86, temp: "4 K", name: "Second stage" },
  { y: 0.15, r: 1.7, temp: "800 mK", name: "Still" },
  { y: -1.25, r: 1.55, temp: "100 mK", name: "Cold plate" },
  { y: -2.55, r: 1.4, temp: "15 mK", name: "Mixing chamber" },
] as const;

/** A fixed, deterministic pose (used to render the project cover). */
export interface StillPose {
  camera: [number, number, number];
  target: [number, number, number];
  rotation: number;
  glint: [number, number, number];
}

// Camera keyframes: [progress, camera y, distance, chandelier x offset (desktop)]
const KEYS: [number, number, number, number][] = [
  [0, 0.2, 15.5, 2.5],
  [0.14, 2.7, 8.4, 0],
  [0.32, 1.25, 7.6, 0],
  [0.5, -0.15, 7.3, 0],
  [0.68, -1.55, 7.3, 0],
  [0.86, -3.0, 7.1, 0],
  [1, -0.8, 13.5, 0],
];

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function sample(p: number) {
  for (let i = 0; i < KEYS.length - 1; i++) {
    const [p0, y0, d0, x0] = KEYS[i]!;
    const [p1, y1, d1, x1] = KEYS[i + 1]!;
    if (p <= p1) {
      const t = ease(Math.min(1, Math.max(0, (p - p0) / (p1 - p0))));
      return { y: y0 + (y1 - y0) * t, d: d0 + (d1 - d0) * t, x: x0 + (x1 - x0) * t };
    }
  }
  const last = KEYS[KEYS.length - 1]!;
  return { y: last[1], d: last[2], x: last[3] };
}

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------
// Instanced primitives
// ---------------------------------------------------------------------------------------------

interface Item {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  rx?: number;
  ry?: number;
  rz?: number;
}

function Instanced({ items, geometry, material }: { items: Item[]; geometry: THREE.BufferGeometry; material: THREE.Material }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    items.forEach((it, i) => {
      e.set(it.rx ?? 0, it.ry ?? 0, it.rz ?? 0);
      q.setFromEuler(e);
      p.set(it.x, it.y, it.z);
      s.set(it.sx, it.sy, it.sz);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items]);
  return <instancedMesh ref={ref} args={[geometry, material, items.length]} frustumCulled={false} />;
}

class Helix extends THREE.Curve<THREE.Vector3> {
  constructor(
    private cx: number,
    private cz: number,
    private y0: number,
    private height: number,
    private radius: number,
    private turns: number,
  ) {
    super();
  }
  override getPoint(t: number, target = new THREE.Vector3()) {
    const a = t * this.turns * Math.PI * 2;
    return target.set(this.cx + Math.cos(a) * this.radius, this.y0 + t * this.height, this.cz + Math.sin(a) * this.radius);
  }
}

// ---------------------------------------------------------------------------------------------
// The chandelier
// ---------------------------------------------------------------------------------------------

function useMaterials() {
  return useMemo(
    () => ({
      gold: new THREE.MeshStandardMaterial({ color: "#c38d48", metalness: 1, roughness: 0.32 }),
      bright: new THREE.MeshStandardMaterial({ color: "#f0c27a", metalness: 1, roughness: 0.16 }),
      cable: new THREE.MeshStandardMaterial({ color: "#e2ad62", metalness: 1, roughness: 0.2 }),
      silver: new THREE.MeshStandardMaterial({ color: "#d8cfc0", metalness: 1, roughness: 0.22 }),
      dark: new THREE.MeshStandardMaterial({ color: "#5b3d1c", metalness: 0.9, roughness: 0.45 }),
      chip: new THREE.MeshStandardMaterial({ color: "#1a1030", emissive: "#7b5cff", emissiveIntensity: 3.2, roughness: 0.4 }),
      pulse: new THREE.MeshBasicMaterial({ color: "#34f5c5", transparent: true, opacity: 0.9, toneMapped: false }),
    }),
    [],
  );
}

function useChandelier(dense: boolean) {
  return useMemo(() => {
    const r = rng(20261121);
    const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 10, 1);
    const thinCylinder = new THREE.CylinderGeometry(1, 1, 1, 6, 1);
    const torus = new THREE.TorusGeometry(1, 0.085, 6, 28);
    const box = new THREE.BoxGeometry(1, 1, 1);

    const plates: Item[] = [];
    const rims: Item[] = [];
    const bolts: Item[] = [];
    const rods: Item[] = [];
    const cables: Item[] = [];
    const loops: Item[] = [];
    const column: Item[] = [];
    const stacks: Item[] = [];
    const helices: THREE.BufferGeometry[] = [];

    // Hangers and top flanges: the whole stack hangs from the cryostat lid.
    for (const [y, rad] of [
      [4.55, 2.3],
      [6.1, 2.45],
    ] as const) {
      plates.push({ x: 0, y, z: 0, sx: rad, sy: 0.1, sz: rad });
      rims.push({ x: 0, y, z: 0, sx: rad, sy: rad, sz: rad, rx: Math.PI / 2 });
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      rods.push({ x: Math.cos(a) * 1.95, y: 5.2, z: Math.sin(a) * 1.95, sx: 0.05, sy: 4.4, sz: 0.05 });
    }

    PLATES.forEach((plate, pi) => {
      plates.push({ x: 0, y: plate.y, z: 0, sx: plate.r, sy: 0.075, sz: plate.r });
      rims.push({ x: 0, y: plate.y, z: 0, sx: plate.r, sy: plate.r, sz: plate.r, rx: Math.PI / 2 });
      rims.push({ x: 0, y: plate.y, z: 0, sx: plate.r * 0.55, sy: plate.r * 0.55, sz: plate.r * 0.55, rx: Math.PI / 2 });
      const nBolts = 28;
      for (let b = 0; b < nBolts; b++) {
        const a = (b / nBolts) * Math.PI * 2;
        bolts.push({ x: Math.cos(a) * plate.r * 0.9, y: plate.y + 0.06, z: Math.sin(a) * plate.r * 0.9, sx: 0.035, sy: 0.07, sz: 0.035 });
      }
      const next = PLATES[pi + 1];
      if (!next) return;
      const top = plate.y;
      const bottom = next.y;
      const gap = top - bottom;
      const mid = (top + bottom) / 2;

      // Support rods
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        rods.push({ x: Math.cos(a) * next.r * 0.93, y: mid, z: Math.sin(a) * next.r * 0.93, sx: 0.04, sy: gap, sz: 0.04 });
      }
      // Coax cable bundles
      const nCables = dense ? 54 : 26;
      for (let i = 0; i < nCables; i++) {
        const a = r() * Math.PI * 2;
        const rad = 0.5 + r() * (next.r * 0.72 - 0.5);
        cables.push({ x: Math.cos(a) * rad, y: mid, z: Math.sin(a) * rad, sx: 0.011, sy: gap, sz: 0.011 });
        // The characteristic coax loops
        if (r() < (dense ? 0.42 : 0.3)) {
          const s = 0.07 + r() * 0.07;
          loops.push({
            x: Math.cos(a) * (rad + s * 0.9),
            y: bottom + 0.25 + r() * (gap - 0.5),
            z: Math.sin(a) * (rad + s * 0.9),
            sx: s,
            sy: s,
            sz: s,
            ry: -a + Math.PI / 2,
            rx: (r() - 0.5) * 0.6,
          });
        }
      }
      // Helical lines
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + pi * 0.7;
        const rad = next.r * 0.62;
        helices.push(new THREE.TubeGeometry(new Helix(Math.cos(a) * rad, Math.sin(a) * rad, bottom + 0.15, gap - 0.3, 0.075, 9), 180, 0.013, 5, false));
      }
      // Central heat exchanger
      for (let y = bottom + 0.15; y < top - 0.1; y += 0.16) {
        column.push({ x: 0, y, z: 0, sx: 0.3, sy: 0.035, sz: 0.3 });
      }
    });

    // Below the mixing chamber plate: amplifier and filter stacks around the cell
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
      for (let k = 0; k < 13; k++) {
        stacks.push({ x: Math.cos(a) * 0.85, y: -2.75 - k * 0.085, z: Math.sin(a) * 0.85, sx: 0.5, sy: 0.055, sz: 0.34, ry: -a });
      }
      helices.push(new THREE.TubeGeometry(new Helix(Math.cos(a + 1) * 0.95, Math.sin(a + 1) * 0.95, -3.95, 1.3, 0.06, 10), 160, 0.012, 5, false));
    }
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      cables.push({ x: Math.cos(a) * 1.18, y: -3.2, z: Math.sin(a) * 1.18, sx: 0.01, sy: 1.25, sz: 0.01 });
    }

    const merged = helices.length ? mergeGeometries(helices) : new THREE.BufferGeometry();
    helices.forEach((g) => g.dispose());
    return { unitCylinder, thinCylinder, torus, box, plates, rims, bolts, rods, cables, loops, column, stacks, helix: merged };
  }, [dense]);
}

function Chandelier({ dense }: { dense: boolean }) {
  const m = useMaterials();
  const g = useChandelier(dense);
  return (
    <group>
      <Instanced items={g.plates} geometry={g.unitCylinder} material={m.gold} />
      <Instanced items={g.rims} geometry={g.torus} material={m.bright} />
      <Instanced items={g.bolts} geometry={g.thinCylinder} material={m.bright} />
      <Instanced items={g.rods} geometry={g.unitCylinder} material={m.gold} />
      <Instanced items={g.cables} geometry={g.thinCylinder} material={m.cable} />
      <Instanced items={g.loops} geometry={g.torus} material={m.cable} />
      <Instanced items={g.column} geometry={g.unitCylinder} material={m.bright} />
      <Instanced items={g.stacks} geometry={g.box} material={m.gold} />
      <mesh geometry={g.helix} material={m.silver} />
      {/* Mixing chamber and the processor */}
      <mesh position={[0, -3.55, 0]} material={m.bright}>
        <cylinderGeometry args={[0.36, 0.36, 2, 40]} />
      </mesh>
      <mesh position={[0, -3.55, 0]} material={m.dark}>
        <cylinderGeometry args={[0.37, 0.37, 0.05, 40]} />
      </mesh>
      <mesh position={[0, -4.6, 0]} material={m.chip}>
        <boxGeometry args={[0.36, 0.06, 0.36]} />
      </mesh>
      <pointLight position={[0, -4.75, 0]} color="#8b6cff" intensity={6} distance={3.5} />
    </group>
  );
}

// ---------------------------------------------------------------------------------------------
// Signal: particles flowing down the cables while the signature is computed
// ---------------------------------------------------------------------------------------------

function dotTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.3, "rgba(255,255,255,0.6)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function Signal({ count, signals }: { count: number; signals: StageSignals }) {
  const ref = useRef<THREE.Points>(null);
  const { positions, colors, speeds } = useMemo(() => {
    const r = rng(7);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = r() * Math.PI * 2;
      const rad = 0.35 + r() * 1.15;
      positions[i * 3] = Math.cos(a) * rad;
      positions[i * 3 + 1] = -4.6 + r() * 9.4;
      positions[i * 3 + 2] = Math.sin(a) * rad;
      speeds[i] = 0.35 + r() * 0.9;
    }
    return { positions, colors, speeds };
  }, [count]);
  const texture = useMemo(dotTexture, []);
  const violet = useMemo(() => new THREE.Color("#8f74ff"), []);
  const mint = useMemo(() => new THREE.Color("#34f5c5"), []);
  const tmp = useMemo(() => new THREE.Color(), []);
  const lastProgress = useRef(0);

  useFrame((_, dt) => {
    const pts = ref.current;
    if (!pts) return;
    const p = signals.progress.current;
    // Scrolling feeds the signal: faster when the page moves.
    const flow = 0.25 + Math.min(4, Math.abs(p - lastProgress.current) * 260);
    lastProgress.current = p;
    const pulseBoost = signals.pulses.current.some((t) => performance.now() / 1000 - t < 1.2) ? 2.5 : 1;
    const pos = pts.geometry.attributes.position as THREE.BufferAttribute;
    const col = pts.geometry.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < count; i++) {
      let y = pos.getY(i) - speeds[i]! * flow * pulseBoost * dt;
      if (y < -4.6) y = 4.8;
      pos.setY(i, y);
      tmp.copy(violet).lerp(mint, Math.min(1, Math.max(0, (4.8 - y) / 9.4)));
      col.setXYZ(i, tmp.r, tmp.g, tmp.b);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  });

  return (
    <points ref={ref} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.075} map={texture} vertexColors transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} sizeAttenuation />
    </points>
  );
}

// ---------------------------------------------------------------------------------------------
// Pulses: a ring of light that runs down the stages after a click
// ---------------------------------------------------------------------------------------------

function radiusAt(y: number) {
  for (let i = 0; i < PLATES.length - 1; i++) {
    const a = PLATES[i]!;
    const b = PLATES[i + 1]!;
    if (y <= a.y && y >= b.y) return a.r + ((b.r - a.r) * (a.y - y)) / (a.y - b.y);
  }
  return y > PLATES[0]!.y ? PLATES[0]!.r : 0.5;
}

function Pulses({ signals }: { signals: StageSignals }) {
  const m = useMaterials();
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  const geometry = useMemo(() => new THREE.TorusGeometry(1, 0.022, 8, 96), []);
  useFrame(() => {
    const now = performance.now() / 1000;
    signals.pulses.current = signals.pulses.current.filter((t) => now - t < 2.2);
    rings.current.forEach((ring, i) => {
      if (!ring) return;
      const t0 = signals.pulses.current[signals.pulses.current.length - 1 - i];
      if (t0 === undefined) {
        ring.visible = false;
        return;
      }
      const k = (now - t0) / 2.2;
      const y = 3.0 - k * 7.6;
      const rad = radiusAt(y) + 0.08;
      ring.visible = true;
      ring.position.y = y;
      ring.scale.set(rad, rad, rad);
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.95 * (1 - k);
    });
  });
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} ref={(el) => (rings.current[i] = el)} geometry={geometry} material={m.pulse.clone()} rotation={[Math.PI / 2, 0, 0]} visible={false} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Scene rig: scroll choreography, drag with inertia, pointer glint
// ---------------------------------------------------------------------------------------------

function Rig({ signals, stage, dense, still }: { signals: StageSignals; stage: number; dense: boolean; still?: StillPose }) {
  const offset = useRef<THREE.Group>(null);
  const spin = useRef<THREE.Group>(null);
  const glint = useRef<THREE.PointLight>(null);
  const smooth = useRef(0);
  const drag = useRef(0);
  const { camera, size } = useThree();
  const wide = size.width / size.height > 1.15;

  useFrame((state, dt) => {
    if (still) {
      camera.position.set(...still.camera);
      camera.lookAt(...still.target);
      if (spin.current) spin.current.rotation.set(0, still.rotation, 0);
      if (offset.current) offset.current.position.x = 0;
      glint.current?.position.set(...still.glint);
      return;
    }
    const target = signals.progress.current;
    smooth.current += (target - smooth.current) * Math.min(1, dt * 4);
    const p = smooth.current;
    const k = sample(p);
    camera.position.set(Math.sin(p * 2.2) * 0.9, k.y + 0.55, k.d);
    camera.lookAt(0, k.y - 0.15, 0);

    drag.current += signals.dragVelocity.current;
    signals.dragVelocity.current *= 0.94;
    if (spin.current) {
      spin.current.rotation.y = state.clock.elapsedTime * 0.12 + p * Math.PI * 3.2 + drag.current;
      spin.current.rotation.x += (signals.pointer.current.y * 0.07 - spin.current.rotation.x) * 0.05;
      spin.current.rotation.z += (signals.pointer.current.x * -0.035 - spin.current.rotation.z) * 0.05;
    }
    if (offset.current) offset.current.position.x = wide ? k.x : 0;
    if (glint.current) {
      glint.current.position.set(signals.pointer.current.x * 3.2 + (wide ? k.x : 0), k.y + signals.pointer.current.y * 2.4, 3.2);
    }
  });

  return (
    <>
      <pointLight ref={glint} color="#fff4e0" intensity={22} distance={9} decay={1.6} />
      <group ref={offset}>
        <group ref={spin}>
          <Chandelier dense={dense} />
          <Signal count={dense ? 700 : 320} signals={signals} />
          <Pulses signals={signals} />
          {PLATES.slice(0, 4).map((p, i) => (
            <pointLight key={i} position={[0, p.y - 0.7, 0]} color="#ff9a45" intensity={4.5} distance={3.2} />
          ))}
        </group>
        {PLATES.map((p, i) =>
          still ? (
            <Html key={p.temp} position={[p.r + 0.08, p.y, 0]} zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
              <div className="flex -translate-y-1/2 items-center gap-3 whitespace-nowrap font-mono">
                <span className="h-px w-28 bg-white/35" />
                <span className="h-1.5 w-1.5 rounded-full bg-mint" />
                <span className="rounded-md bg-ink/85 px-2 py-0.5 text-[15px] text-white">
                  {p.temp} <span className="text-[13px] text-white/50">{p.name}</span>
                </span>
              </div>
            </Html>
          ) : (
            <Html key={p.temp} position={[p.r + 0.35, p.y + 0.05, 0]} distanceFactor={6.5} zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
              <div
                className={`whitespace-nowrap rounded-full border px-3 py-1 font-mono text-[13px] transition-all duration-500 ${
                  stage === i ? "border-mint/70 bg-mint/15 text-mint" : "border-white/10 bg-black/30 text-white/40"
                }`}
              >
                {p.temp}
              </div>
            </Html>
          ),
        )}
      </group>
    </>
  );
}

export default function QuantumComputer({
  signals,
  stage,
  active,
  still,
}: {
  signals: StageSignals;
  stage: number;
  active: boolean;
  still?: StillPose;
}) {
  const dense = Boolean(still) || (typeof window !== "undefined" && window.innerWidth > 900);
  return (
    <Canvas
      frameloop={active ? "always" : "never"}
      dpr={[1, dense ? 1.75 : 1.4]}
      camera={{ fov: 35, near: 0.1, far: 80, position: [0, 0.2, 15.5] }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      fallback={<div className="grid h-full place-items-center text-fog">3D needs WebGL</div>}
      className="!absolute inset-0"
    >
      <fog attach="fog" args={["#080808", 12, 30]} />
      <ambientLight intensity={0.18} />
      <directionalLight position={[4, 8, 6]} intensity={1.4} color="#ffe2b0" />
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={3} color="#ffd8a0" position={[0, 6, -4]} scale={[12, 2.5, 1]} />
        <Lightformer form="rect" intensity={2.2} color="#ffffff" position={[-6, 1, 2]} rotation-y={Math.PI / 2} scale={[8, 3, 1]} />
        <Lightformer form="rect" intensity={1.6} color="#a28bff" position={[6, -1, 2]} rotation-y={-Math.PI / 2} scale={[8, 3, 1]} />
        <Lightformer form="ring" intensity={2} color="#ffb86b" position={[0, -6, 3]} scale={4} />
      </Environment>
      <Rig signals={signals} stage={stage} dense={dense} still={still} />
      {still ? (
        <EffectComposer multisampling={4}>
          <Bloom mipmapBlur luminanceThreshold={0.82} luminanceSmoothing={0.2} intensity={0.7} />
        </EffectComposer>
      ) : (
        <EffectComposer multisampling={0}>
          <Bloom mipmapBlur luminanceThreshold={0.82} luminanceSmoothing={0.2} intensity={0.75} />
          <Vignette eskil={false} offset={0.25} darkness={0.75} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
