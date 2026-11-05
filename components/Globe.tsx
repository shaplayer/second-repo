"use client";
import createGlobe from "cobe";
import { useEffect, useRef } from "react";

// Major market centers: the dots that pulse on the globe.
const MARKETS: [number, number][] = [
  [40.7069, -74.0113], // New York (NYSE / Nasdaq)
  [41.8781, -87.6298], // Chicago
  [43.6532, -79.3832], // Toronto
  [37.7749, -122.4194], // San Francisco
  [51.5155, -0.0922], // London
  [50.1109, 8.6821], // Frankfurt
  [48.8566, 2.3522], // Paris
  [35.6812, 139.7671], // Tokyo
  [22.2793, 114.1628], // Hong Kong
  [31.2304, 121.4737], // Shanghai
  [1.2834, 103.8517], // Singapore
  [19.076, 72.8777], // Mumbai
  [-33.8688, 151.2093], // Sydney
  [-23.5505, -46.6333], // São Paulo
  [25.2048, 55.2708], // Dubai
];

export function Globe({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointer = useRef<{ x: number; phi: number } | null>(null);
  const phi = useRef(5.4); // start over the Atlantic: Americas + Europe in view
  const velocity = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = canvas.offsetWidth;
    const ro = new ResizeObserver(() => { width = canvas.offsetWidth; });
    ro.observe(canvas);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let t = 0;

    const globe = createGlobe(canvas, {
      devicePixelRatio: dpr,
      width: width * dpr,
      height: width * dpr,
      phi: phi.current,
      theta: 0.28,
      dark: 1,
      diffuse: 1.15,
      mapSamples: 22000,
      mapBrightness: 4.2,
      mapBaseBrightness: 0.02,
      baseColor: [0.13, 0.15, 0.16],
      markerColor: [0.07, 0.886, 0.478],
      glowColor: [0.04, 0.22, 0.13],
      markers: MARKETS.map((location) => ({ location, size: 0.04 })),
      onRender: (state) => {
        t += 1;
        if (!pointer.current) {
          velocity.current *= 0.95;
          phi.current += (reduce ? 0 : 0.0022) + velocity.current;
        }
        state.phi = phi.current;
        state.width = width * dpr;
        state.height = width * dpr;
        // Staggered pulse on each market marker.
        state.markers = MARKETS.map((location, i) => ({
          location,
          size: 0.03 + 0.025 * Math.max(0, Math.sin(t / 28 + i * 1.7)),
        }));
      },
    });
    requestAnimationFrame(() => { canvas.style.opacity = "1"; });
    return () => { globe.destroy(); ro.disconnect(); };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-label="Rotating globe showing major stock market centers. Drag to spin."
      role="img"
      className={`aspect-square w-full cursor-grab touch-pan-y opacity-0 transition-opacity duration-[1200ms] active:cursor-grabbing ${className}`}
      onPointerDown={(e) => {
        pointer.current = { x: e.clientX, phi: phi.current };
        (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!pointer.current) return;
        const next = pointer.current.phi + (e.clientX - pointer.current.x) / 180;
        velocity.current = next - phi.current;
        phi.current = next;
      }}
      onPointerUp={() => { pointer.current = null; }}
      onPointerCancel={() => { pointer.current = null; }}
    />
  );
}
