'use client';

import React, { useEffect, useRef, useState } from 'react';
import { X, Download, Copy, CheckCircle2, QrCode } from 'lucide-react';
import QRCode from 'qrcode';

const LEADS_LOGO_SRC = '/images/leads-short-logo.png';

function isIOSDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIPadOS = ua.includes('Macintosh') && typeof document !== 'undefined' && 'ontouchend' in document;
  return /iPad|iPhone|iPod/.test(ua) || isIPadOS;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
}

/** Same center-logo overlay treatment as FormQrModal — see form-qr-modal.tsx for the original. */
function drawCenterLogo(canvas: HTMLCanvasElement | null): Promise<void> {
  return new Promise((resolve) => {
    if (!canvas) { resolve(); return; }
    const ctx = canvas.getContext('2d');
    if (!ctx) { resolve(); return; }

    const logo = new Image();
    logo.onload = () => {
      const size = canvas.width;
      const logoSize = Math.round(size * 0.2);
      const pad = Math.round(logoSize * 0.16);
      const boxSize = logoSize + pad * 2;
      const boxX = (size - boxSize) / 2;
      const boxY = (size - boxSize) / 2;
      const radius = Math.round(boxSize * 0.14);

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(boxX + radius, boxY);
      ctx.arcTo(boxX + boxSize, boxY, boxX + boxSize, boxY + boxSize, radius);
      ctx.arcTo(boxX + boxSize, boxY + boxSize, boxX, boxY + boxSize, radius);
      ctx.arcTo(boxX, boxY + boxSize, boxX, boxY, radius);
      ctx.arcTo(boxX, boxY, boxX + boxSize, boxY, radius);
      ctx.closePath();
      ctx.fill();

      ctx.drawImage(logo, (size - logoSize) / 2, (size - logoSize) / 2, logoSize, logoSize);
      resolve();
    };
    logo.onerror = () => resolve();
    logo.src = LEADS_LOGO_SRC;
  });
}

interface CardQrModalProps {
  isOpen: boolean;
  onClose: () => void;
  url: string;
  title: string;
  subtitle?: string;
}

export function CardQrModal({ isOpen, onClose, url, title, subtitle }: CardQrModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    if (!isOpen || !url || !canvasRef.current) return;
    QRCode.toCanvas(
      canvasRef.current,
      url,
      { width: 260, margin: 2, color: { dark: '#0B1B2E', light: '#ffffff' }, errorCorrectionLevel: 'H' },
      (error) => {
        if (error) { console.error('Failed to generate QR Code:', error); return; }
        drawCenterLogo(canvasRef.current);
      }
    );
  }, [isOpen, url]);

  if (!isOpen) return null;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadImage = async () => {
    setIsGenerating(true);
    try {
      const qrSize = 480;
      const qrCanvas = document.createElement('canvas');
      await QRCode.toCanvas(qrCanvas, url, {
        width: qrSize,
        margin: 2,
        color: { dark: '#0B1B2E', light: '#ffffff' },
        errorCorrectionLevel: 'H',
      });
      await drawCenterLogo(qrCanvas);

      const filename = 'visiting-card-qr.png';
      const blob = await canvasToBlob(qrCanvas);
      if (!blob) {
        const dataUrl = qrCanvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = filename;
        link.href = dataUrl;
        link.click();
        return;
      }

      // iOS Safari ignores <a download> — route through the share sheet instead.
      if (isIOSDevice()) {
        const file = new File([blob], filename, { type: 'image/png' });
        const canShareFile = typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
        if (canShareFile && navigator.share) {
          try {
            await navigator.share({ files: [file], title: filename });
            return;
          } catch {
            // fall through
          }
        }
        window.open(URL.createObjectURL(blob), '_blank');
        return;
      }

      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = filename;
      link.href = blobUrl;
      link.click();
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('Error generating QR image:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="glass-panel w-full max-w-md rounded-3xl p-6 flex flex-col items-center text-center space-y-5 relative border border-white/20 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 h-8 w-8 flex items-center justify-center rounded-xl hover:bg-theme-border/30 text-theme-text-secondary hover:text-theme-text-primary transition-all cursor-pointer"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex flex-col items-center space-y-1.5 pt-2">
          <div className="h-12 w-12 bg-accent/15 border border-accent/30 rounded-2xl flex items-center justify-center text-accent shadow-inner">
            <QrCode className="h-6 w-6" />
          </div>
          <h2 className="text-base font-bold text-theme-text-primary">{title}</h2>
          {subtitle && <p className="text-xs text-theme-text-secondary max-w-xs line-clamp-1">{subtitle}</p>}
        </div>

        <div className="p-4 bg-white rounded-2xl shadow-xl border border-slate-200/80 flex flex-col items-center justify-center space-y-2">
          <canvas ref={canvasRef} className="rounded-lg shadow-inner max-w-full" />
          <span className="text-[10px] text-slate-500 font-mono tracking-tight break-all px-2 max-w-[260px]">{url}</span>
        </div>

        <p className="text-[11px] text-theme-text-secondary max-w-xs">
          Scan this QR code with any smartphone camera to open the visiting card.
        </p>

        <div className="w-full flex items-center gap-2.5 pt-1">
          <button
            onClick={handleDownloadImage}
            disabled={isGenerating}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 bg-accent hover:bg-primary-light text-white text-xs font-semibold rounded-xl transition-all shadow-md shadow-accent/20 cursor-pointer disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Download PNG
          </button>
          <button
            onClick={handleCopyLink}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 bg-theme-border/20 hover:bg-theme-border/40 text-theme-text-secondary hover:text-theme-text-primary text-xs font-medium rounded-xl transition-all cursor-pointer"
          >
            {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied!' : 'Copy Link'}
          </button>
        </div>
      </div>
    </div>
  );
}
