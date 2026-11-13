'use client';

import React, { useRef } from 'react';

export interface HeaderFraming {
  posX: number;   // 0-100, which part of the picture sits in the centre of the frame
  posY: number;
  zoom: number;   // 100-300 (%)
  height: number; // banner height in px
}

export const DEFAULT_HEADER_FRAMING: HeaderFraming = { posX: 50, posY: 50, zoom: 100, height: 160 };

/** The banner picture's inline style, shared by the builder preview and the public form. */
export function headerImageStyle(f: HeaderFraming): React.CSSProperties {
  return { objectPosition: `${f.posX}% ${f.posY}%`, transform: `scale(${f.zoom / 100})`, transformOrigin: `${f.posX}% ${f.posY}%` };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
// The public card is max-w-xl (576px) wide; the preview uses the same aspect ratio so what you frame is what visitors get
const CARD_WIDTH = 576;

interface Props {
  url: string;
  value: HeaderFraming;
  onChange: (v: HeaderFraming) => void;
}

export function FormHeaderFraming({ url, value, onChange }: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; posX: number; posY: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, posX: value.posX, posY: value.posY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = frameRef.current;
    if (!d || !el) return;
    // Dragging moves the picture with the pointer, i.e. the focal point moves the opposite way
    const dx = ((e.clientX - d.x) / el.clientWidth) * 100;
    const dy = ((e.clientY - d.y) / el.clientHeight) * 100;
    onChange({ ...value, posX: clamp(Math.round(d.posX - dx), 0, 100), posY: clamp(Math.round(d.posY - dy), 0, 100) });
  };
  const onPointerUp = () => { drag.current = null; };

  const slider = (label: string, min: number, max: number, step: number, key: keyof HeaderFraming, suffix: string) => (
    <label className="flex items-center justify-between gap-3 text-theme-text-secondary">
      <span className="w-28 shrink-0">{label}: {value[key]}{suffix}</span>
      <input type="range" min={min} max={max} step={step} value={value[key]} onChange={(e) => onChange({ ...value, [key]: Number(e.target.value) })} className="flex-1 accent-accent" />
    </label>
  );

  return (
    <div className="space-y-2 p-3 rounded-xl border border-theme-card-border">
      <p className="text-[10px] text-theme-text-secondary">Drag the picture to choose what shows in the banner, and use the sliders to zoom or change the banner height.</p>
      <div
        ref={frameRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ aspectRatio: `${CARD_WIDTH} / ${value.height}`, touchAction: 'none' }}
        className="relative w-full overflow-hidden rounded-lg cursor-grab active:cursor-grabbing select-none"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" draggable={false} className="h-full w-full object-cover pointer-events-none" style={headerImageStyle(value)} />
      </div>
      {slider('Zoom', 100, 300, 5, 'zoom', '%')}
      {slider('Banner height', 80, 320, 10, 'height', 'px')}
      <button type="button" onClick={() => onChange(DEFAULT_HEADER_FRAMING)} className="text-[11px] font-semibold text-accent hover:underline cursor-pointer">Reset framing</button>
    </div>
  );
}
