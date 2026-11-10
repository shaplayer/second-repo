"use client";
import { useEffect, useRef } from "react";

export type Frame = { ctx: CanvasRenderingContext2D; w: number; h: number; t: number; dt: number };

/**
 * Sizes a canvas to its box (device-pixel sharp), and calls `draw` every frame.
 * With prefers-reduced-motion, or when the canvas is off screen, it stops animating.
 */
export function useCanvas(draw: (f: Frame) => void, setup?: (w: number, h: number) => void) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  const setupRef = useRef(setup);
  drawRef.current = draw;
  setupRef.current = setup;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, raf = 0, last = performance.now(), visible = true, start = last;

    const size = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = r.width; h = r.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      setupRef.current?.(w, h);
      if (reduce) frame(performance.now());
    };
    const frame = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      ctx.clearRect(0, 0, w, h);
      drawRef.current({ ctx, w, h, t: reduce ? 0 : now - start, dt: reduce ? 0 : dt });
    };
    const loop = (now: number) => {
      if (visible) frame(now);
      raf = requestAnimationFrame(loop);
    };

    const ro = new ResizeObserver(size);
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; last = performance.now(); });
    io.observe(canvas);
    size();
    if (!reduce) raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
  }, []);

  return ref;
}

/** Small deterministic PRNG so the server and every visit start from the same picture. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const BRAND = "18, 226, 122";
export const DOWN = "255, 90, 95";
