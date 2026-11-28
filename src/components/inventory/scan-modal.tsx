'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { Modal, Banner, inputCls, btnPrimary } from '@/components/billing-ui';

/** Camera QR scanner (jsQR) with a manual-entry fallback for devices without a camera. */
export function ScanModal({ onResult, onClose }: { onResult: (value: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [manual, setManual] = useState('');
  const doneRef = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let cancelled = false;
    const canvas = document.createElement('canvas');

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera is not available in this browser (it needs HTTPS or localhost).');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        const { default: jsQR } = await import('jsqr');
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        const tick = () => {
          if (cancelled || doneRef.current) return;
          if (video.readyState >= 2 && video.videoWidth) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
            if (hit?.data) {
              doneRef.current = true;
              onResult(hit.data);
              return;
            }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch (e: any) {
        setError(e?.message || 'Could not start the camera. You can type the item code instead.');
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach(t => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal title="Scan item QR code" onClose={onClose}>
      <div className="space-y-4">
        <div className="relative overflow-hidden rounded-xl bg-black aspect-square max-h-[50vh] mx-auto">
          <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
          {!error && <div className="pointer-events-none absolute inset-8 rounded-xl border-2 border-white/70" />}
          {error && <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-white/80"><Camera className="h-5 w-5 mr-2 shrink-0" />Camera unavailable</div>}
        </div>
        {error && <Banner kind="error">{error}</Banner>}
        <form
          className="flex gap-2"
          onSubmit={e => { e.preventDefault(); if (manual.trim()) { doneRef.current = true; onResult(manual.trim()); } }}
        >
          <input
            className={`${inputCls} font-mono uppercase flex-1`}
            placeholder="…or type an item code, e.g. RTBI-LAB-1001"
            value={manual}
            onChange={e => setManual(e.target.value)}
          />
          <button className={btnPrimary} type="submit">Find</button>
        </form>
      </div>
    </Modal>
  );
}
