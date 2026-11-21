"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "./ThemeProvider";

/** Canvas ambient FX (fireflies + petals + grass) with ~1s day/night blend. Ported from upstream reference engine. */

type Fly = {
  x: number; y: number; size: number;
  breatheDur: number; breatheT: number;
  floatDur: number; floatT: number; path: number;
  ox: number; oy: number;
};

type Petal = {
  x: number; size: number; dur: number; t: number;
};

type Blade = {
  x: number; h: number; w: number; dur: number; t: number; opacity: number; leftCurve: boolean;
};

const PATHS: [number, number][][] = [
  [[0, 0], [0.1, -0.15], [-0.05, -0.2], [0, 0]],
  [[0, 0], [-0.12, 0.1], [0.08, 0.15], [0, 0]],
  [[0, 0], [0.15, 0.15], [-0.1, 0.05], [0, 0]],
  [[0, 0], [-0.15, -0.1], [0.1, -0.15], [0, 0]],
];

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function samplePath(path: number, u: number, w: number, h: number): [number, number] {
  const pts = PATHS[path % 4];
  const n = pts.length - 1;
  const x = u * n;
  const i = Math.min(Math.floor(x), n - 1);
  const f = easeInOut(x - i);
  const a = pts[i];
  const b = pts[i + 1];
  return [a[0] + (b[0] - a[0]) * f * w, a[1] + (b[1] - a[1]) * f * h];
}

function makeFlySprite(size: number): HTMLCanvasElement {
  const pad = Math.ceil(size * 4);
  const c = document.createElement("canvas");
  c.width = c.height = pad * 2;
  const g = c.getContext("2d")!;
  const cx = pad;
  const cy = pad;
  const grd = g.createRadialGradient(cx, cy, 0, cx, cy, pad);
  grd.addColorStop(0, "rgba(200,255,200,1)");
  grd.addColorStop(0.35, "rgba(100,255,150,0.75)");
  grd.addColorStop(1, "rgba(50,255,100,0)");
  g.fillStyle = grd;
  g.beginPath();
  g.arc(cx, cy, pad, 0, Math.PI * 2);
  g.fill();
  return c;
}

function makePetalSprite(size: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  const w = Math.ceil(size);
  const h = Math.ceil(size * 1.2);
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(255,182,193,0.85)";
  g.beginPath();
  g.moveTo(w, 0);
  g.quadraticCurveTo(w, h, 0, h);
  g.quadraticCurveTo(0, 0, w, 0);
  g.fill();
  return c;
}

function makeGrassSprite(h: number, w: number, leftCurve: boolean, night: boolean): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(4, Math.ceil(w * 4));
  c.height = Math.ceil(h);
  const g = c.getContext("2d")!;
  const grd = g.createLinearGradient(0, h, 0, 0);
  if (night) {
    grd.addColorStop(0, "rgba(255,255,255,0.8)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
  } else {
    grd.addColorStop(0, "rgba(16,185,129,0.8)");
    grd.addColorStop(1, "rgba(16,185,129,0)");
  }
  g.fillStyle = grd;
  const bw = Math.max(1, w);
  const x0 = leftCurve ? c.width / 2 : c.width / 2 - bw;
  g.beginPath();
  if (leftCurve) {
    g.moveTo(x0 + bw, h);
    g.quadraticCurveTo(x0, h / 2, x0 + bw / 2, 0);
    g.quadraticCurveTo(x0 + bw, h / 2, x0 + bw, h);
  } else {
    g.moveTo(x0, h);
    g.quadraticCurveTo(x0 + bw, h / 2, x0 + bw / 2, 0);
    g.quadraticCurveTo(x0, h / 2, x0, h);
  }
  g.fill();
  return c;
}

export default function AmbientEffects() {
  const { isDark } = useTheme();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const blendRef = useRef(isDark ? 1 : 0);
  const targetRef = useRef(isDark ? 1 : 0);
  const activeRef = useRef(false);

  useEffect(() => {
    targetRef.current = isDark ? 1 : 0;
  }, [isDark]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let dpr = 1;
    let raf = 0;
    let last = performance.now();
    let flies: Fly[] = [];
    let petals: Petal[] = [];
    let blades: Blade[] = [];
    let flySprites: HTMLCanvasElement[] = [];
    let petalSprites: HTMLCanvasElement[] = [];
    let grassDay: HTMLCanvasElement[] = [];
    let grassNight: HTMLCanvasElement[] = [];

    const mqDesktop = window.matchMedia("(min-width: 768px)");
    const mqReduce = window.matchMedia("(prefers-reduced-motion: reduce)");

    const syncActive = () => {
      activeRef.current =
        document.visibilityState === "visible" &&
        mqDesktop.matches &&
        !mqReduce.matches;
      wrap.dataset.paused = activeRef.current ? "0" : "1";
      if (activeRef.current && !raf) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };

    const rebuildSprites = () => {
      flySprites = [3, 4, 5, 6, 7].map(makeFlySprite);
      petalSprites = [8, 12, 16, 20].map(makePetalSprite);
      grassDay = blades.map((b) => makeGrassSprite(b.h, b.w, b.leftCurve, false));
      grassNight = blades.map((b) => makeGrassSprite(b.h, b.w, b.leftCurve, true));
    };

    const initEntities = () => {
      flies = Array.from({ length: 50 }, () => ({
        ox: Math.random(),
        oy: Math.random(),
        x: 0,
        y: 0,
        size: 3 + Math.random() * 4,
        breatheDur: 3 + Math.random() * 5,
        breatheT: Math.random() * 10,
        floatDur: 15 + Math.random() * 20,
        floatT: Math.random() * 20,
        path: Math.floor(Math.random() * 4),
      }));
      petals = Array.from({ length: 40 }, () => ({
        x: Math.random(),
        size: 8 + Math.random() * 12,
        dur: 6 + Math.random() * 8,
        t: Math.random() * 15,
      }));
      blades = Array.from({ length: 150 }, (_, i) => ({
        x: i / 150 + (Math.random() - 0.5) * 0.005,
        h: 30 + Math.random() * 50,
        w: 1 + Math.random() * 2,
        dur: 3 + Math.random() * 4,
        t: Math.random() * 10,
        opacity: 0.2 + Math.random() * 0.4,
        leftCurve: Math.random() > 0.5,
      }));
      rebuildSprites();
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const frame = (now: number) => {
      raf = 0;
      if (!activeRef.current) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const target = targetRef.current;
      let b = blendRef.current;
      if (b < target) b = Math.min(target, b + dt);
      else if (b > target) b = Math.max(target, b - dt);
      blendRef.current = b;

      canvas.style.mixBlendMode = b > 0.5 ? "screen" : "normal";

      ctx.clearRect(0, 0, w, h);

      // Grass at bottom
      for (let i = 0; i < blades.length; i++) {
        const blade = blades[i];
        blade.t += dt;
        const phase = (blade.t % blade.dur) / blade.dur;
        const sway = phase < 0.5 ? phase * 2 : 2 - phase * 2;
        const angle = (-5 + 20 * sway) * (Math.PI / 180);
        const gx = blade.x * w;
        const gy = h;
        ctx.save();
        ctx.translate(gx, gy);
        ctx.rotate(angle);
        ctx.globalAlpha = blade.opacity * (1 - b);
        if (grassDay[i]) ctx.drawImage(grassDay[i], -grassDay[i].width / 2, -blade.h);
        ctx.globalAlpha = blade.opacity * b;
        if (grassNight[i]) ctx.drawImage(grassNight[i], -grassNight[i].width / 2, -blade.h);
        ctx.restore();
      }

      // Petals (day)
      if (b < 1) {
        for (const p of petals) {
          p.t += dt;
          const progress = (p.t % p.dur) / p.dur;
          const px = p.x * w + 0.15 * progress * w;
          const py = -0.1 * h + 1.2 * progress * h;
          let alpha = 1;
          if (progress < 0.1) alpha = progress / 0.1;
          else if (progress > 0.8) alpha = (1 - progress) / 0.2;
          alpha *= 1 - b;
          const sprite = petalSprites[Math.min(petalSprites.length - 1, Math.floor((p.size - 8) / 4))];
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(progress * Math.PI * 2);
          ctx.globalAlpha = Math.max(0, alpha);
          if (sprite) ctx.drawImage(sprite, -sprite.width / 2, -sprite.height / 2);
          ctx.restore();
        }
      }

      // Fireflies (night)
      if (b > 0) {
        for (const f of flies) {
          f.floatT += dt;
          f.breatheT += dt;
          const fu = (f.floatT % f.floatDur) / f.floatDur;
          const [dx, dy] = samplePath(f.path, fu, w, h);
          const fx = f.ox * w + dx;
          const fy = f.oy * h + dy;
          const bu = (f.breatheT % f.breatheDur) / f.breatheDur;
          const breathe = bu < 0.5 ? bu * 2 : 2 - bu * 2;
          const alpha = b * breathe;
          const si = Math.min(flySprites.length - 1, Math.max(0, Math.round(f.size) - 3));
          const sprite = flySprites[si];
          if (sprite && alpha > 0.02) {
            ctx.globalAlpha = alpha;
            const s = f.size * (0.6 + breathe * 0.8);
            ctx.drawImage(sprite, fx - s * 2, fy - s * 2, s * 4, s * 4);
          }
        }
        ctx.globalAlpha = 1;
      }

      raf = requestAnimationFrame(frame);
    };

    initEntities();
    resize();
    syncActive();

    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", syncActive);
    mqDesktop.addEventListener("change", syncActive);
    mqReduce.addEventListener("change", syncActive);

    return () => {
      activeRef.current = false;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", syncActive);
      mqDesktop.removeEventListener("change", syncActive);
      mqReduce.removeEventListener("change", syncActive);
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      className="ambient-effects pointer-events-none absolute inset-0 overflow-hidden"
      style={{ contain: "layout paint", isolation: "isolate" }}
      aria-hidden
    >
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  );
}
