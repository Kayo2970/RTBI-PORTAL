'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  X,
  RotateCw,
  ZoomIn,
  ZoomOut,
  Check,
  Move,
  Sparkles,
  RefreshCw,
} from 'lucide-react';

export interface ImageCropModalProps {
  isOpen: boolean;
  imageSrc: string | null;
  fileName?: string;
  title?: string;
  description?: string;
  outputSize?: number;
  onCropComplete: (file: File, dataUrl: string) => void;
  onClose: () => void;
}

export function ImageCropModal({
  isOpen,
  imageSrc,
  fileName = 'cropped-photo.jpg',
  title = 'Frame Visiting Card Photo',
  description = 'Drag to reposition and zoom to frame your photo for 3D card display and wallet passes.',
  outputSize = 640,
  onCropComplete,
  onClose,
}: ImageCropModalProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [naturalWidth, setNaturalWidth] = useState(320);
  const [naturalHeight, setNaturalHeight] = useState(320);

  // Crop transformations
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0); // 0, 90, 180, 270
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isProcessing, setIsProcessing] = useState(false);

  // Preview / Viewport DOM refs
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const miniCanvasRef = useRef<HTMLCanvasElement>(null);
  const miniCardCanvasRef = useRef<HTMLCanvasElement>(null);

  // Reliable image loading
  useEffect(() => {
    if (!isOpen || !imageSrc) {
      setImageLoaded(false);
      return;
    }

    setZoom(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
    setImageLoaded(false);

    // Preload image to get natural dimensions reliably
    const img = new Image();
    if (imageSrc.startsWith('http://') || imageSrc.startsWith('https://')) {
      img.crossOrigin = 'anonymous';
    }

    const onImageReady = () => {
      setNaturalWidth(img.naturalWidth || 320);
      setNaturalHeight(img.naturalHeight || 320);
      setImageLoaded(true);
    };

    img.onload = onImageReady;
    img.onerror = () => {
      if (img.crossOrigin) {
        const fallback = new Image();
        fallback.onload = () => {
          setNaturalWidth(fallback.naturalWidth || 320);
          setNaturalHeight(fallback.naturalHeight || 320);
          setImageLoaded(true);
        };
        fallback.onerror = () => {
          setNaturalWidth(320);
          setNaturalHeight(320);
          setImageLoaded(true);
        };
        fallback.src = imageSrc;
      } else {
        setNaturalWidth(320);
        setNaturalHeight(320);
        setImageLoaded(true);
      }
    };

    img.src = imageSrc;

    if (img.complete && img.naturalWidth > 0) {
      onImageReady();
    }
  }, [isOpen, imageSrc]);

  // Handle DOM image load
  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.naturalWidth > 0) {
      setNaturalWidth(img.naturalWidth);
      setNaturalHeight(img.naturalHeight);
      setImageLoaded(true);
    }
  };

  // Drag / Pan Handlers
  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
    if (viewportRef.current) {
      viewportRef.current.setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setOffset({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDragging) {
      setIsDragging(false);
      if (viewportRef.current && viewportRef.current.hasPointerCapture(e.pointerId)) {
        viewportRef.current.releasePointerCapture(e.pointerId);
      }
    }
  };

  // Wheel zoom inside viewport
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY * -0.0015;
    setZoom((prev) => Math.min(Math.max(prev + delta, 0.8), 3.5));
  };

  const rotate90 = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  const resetTransforms = () => {
    setZoom(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
  };

  // Render crop onto mini canvases
  const updateMiniCanvases = useCallback(() => {
    if (!imageRef.current) return;
    const img = imageRef.current;
    const nw = img.naturalWidth || naturalWidth || 320;
    const nh = img.naturalHeight || naturalHeight || 320;
    if (nw <= 0 || nh <= 0) return;

    const viewportEl = viewportRef.current;
    const cropSize = viewportEl ? Math.min(viewportEl.clientWidth, viewportEl.clientHeight) : 320;
    const fitScale = Math.max(cropSize / nw, cropSize / nh);
    const effectiveScale = fitScale * zoom;

    // Mini circle canvas
    if (miniCanvasRef.current) {
      const size = 96;
      const miniCanvas = miniCanvasRef.current;
      miniCanvas.width = size;
      miniCanvas.height = size;
      const ctx = miniCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, size, size);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        const scaleMultiplier = size / cropSize;
        ctx.save();
        ctx.translate(size / 2, size / 2);
        ctx.translate(offset.x * scaleMultiplier, offset.y * scaleMultiplier);
        ctx.rotate((rotation * Math.PI) / 180);

        const drawW = nw * effectiveScale * scaleMultiplier;
        const drawH = nh * effectiveScale * scaleMultiplier;
        try {
          ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
        } catch {
          // ignore cross-origin draw errors in preview
        }
        ctx.restore();
      }
    }

    // Mini card canvas
    if (miniCardCanvasRef.current) {
      const size = 96;
      const miniCardCanvas = miniCardCanvasRef.current;
      miniCardCanvas.width = size;
      miniCardCanvas.height = size;
      const ctx = miniCardCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, size, size);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        const scaleMultiplier = size / cropSize;
        ctx.save();
        ctx.translate(size / 2, size / 2);
        ctx.translate(offset.x * scaleMultiplier, offset.y * scaleMultiplier);
        ctx.rotate((rotation * Math.PI) / 180);

        const drawW = nw * effectiveScale * scaleMultiplier;
        const drawH = nh * effectiveScale * scaleMultiplier;
        try {
          ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
        } catch {
          // ignore
        }
        ctx.restore();
      }
    }
  }, [zoom, offset, rotation, naturalWidth, naturalHeight]);

  useEffect(() => {
    if (imageLoaded) {
      updateMiniCanvases();
    }
  }, [imageLoaded, zoom, offset, rotation, updateMiniCanvases]);

  // Generate cropped output canvas
  const handleApplyCrop = useCallback(async () => {
    if (!imageRef.current) return;
    setIsProcessing(true);

    try {
      const img = imageRef.current;
      const nw = img.naturalWidth || naturalWidth || 320;
      const nh = img.naturalHeight || naturalHeight || 320;

      const canvas = document.createElement('canvas');
      canvas.width = outputSize;
      canvas.height = outputSize;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        throw new Error('Canvas context not available');
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      const viewportEl = viewportRef.current;
      const viewportWidth = viewportEl ? viewportEl.clientWidth : 320;
      const viewportHeight = viewportEl ? viewportEl.clientHeight : 320;
      const cropSize = Math.min(viewportWidth, viewportHeight);

      const fitScale = Math.max(cropSize / nw, cropSize / nh);
      const effectiveScale = fitScale * zoom;

      ctx.save();
      ctx.translate(outputSize / 2, outputSize / 2);

      const scaleMultiplier = outputSize / cropSize;
      ctx.translate(offset.x * scaleMultiplier, offset.y * scaleMultiplier);
      ctx.rotate((rotation * Math.PI) / 180);

      const drawW = nw * effectiveScale * scaleMultiplier;
      const drawH = nh * effectiveScale * scaleMultiplier;

      ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.restore();

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92);
      });

      if (!blob) {
        throw new Error('Failed to generate image file');
      }

      const cleanFileName = (fileName || 'photo').replace(/\.[^/.]+$/, '') + '-cropped.jpg';
      const croppedFile = new File([blob], cleanFileName, {
        type: 'image/jpeg',
        lastModified: Date.now(),
      });

      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      onCropComplete(croppedFile, dataUrl);
      onClose();
    } catch (err) {
      console.error('Error cropping image:', err);
      // Fallback: create canvas from Image object
      try {
        const directImg = new Image();
        if (imageSrc && (imageSrc.startsWith('http://') || imageSrc.startsWith('https://'))) {
          directImg.crossOrigin = 'anonymous';
        }
        await new Promise<void>((resolve, reject) => {
          directImg.onload = () => resolve();
          directImg.onerror = reject;
          directImg.src = imageSrc || '';
        });

        const canvas = document.createElement('canvas');
        canvas.width = outputSize;
        canvas.height = outputSize;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(directImg, 0, 0, outputSize, outputSize);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
          const blob = await (await fetch(dataUrl)).blob();
          const croppedFile = new File([blob], 'photo-cropped.jpg', { type: 'image/jpeg' });
          onCropComplete(croppedFile, dataUrl);
          onClose();
        }
      } catch (fallbackErr) {
        console.error('Fallback crop also failed:', fallbackErr);
      }
    } finally {
      setIsProcessing(false);
    }
  }, [naturalWidth, naturalHeight, outputSize, zoom, offset, rotation, fileName, imageSrc, onCropComplete, onClose]);

  if (!isOpen || !imageSrc) return null;

  const isLandscape = naturalWidth >= naturalHeight;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-theme-card-bg border border-theme-card-border rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[94vh]">
        {/* Header */}
        <div className="p-4 sm:px-5 sm:py-3.5 border-b border-theme-card-border flex items-center justify-between bg-theme-header-bg/50 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-accent/15 border border-accent/25 flex items-center justify-center text-accent shrink-0">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-semibold text-sm sm:text-base text-theme-text-primary">{title}</h3>
              <p className="text-[11px] sm:text-xs text-theme-text-secondary mt-0.5">{description}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-theme-text-secondary hover:text-theme-text-primary hover:bg-white/5 transition-colors cursor-pointer"
            title="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Viewport / Crop Canvas Area */}
        <div className="p-4 sm:p-5 flex flex-col items-center justify-center gap-3.5 bg-theme-background/30 select-none overflow-y-auto flex-1 min-h-0">
          <div
            ref={viewportRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onWheel={handleWheel}
            className="relative w-[240px] h-[240px] sm:w-[280px] sm:h-[280px] rounded-2xl overflow-hidden bg-neutral-950 flex items-center justify-center border-2 border-theme-card-border shadow-inner cursor-grab active:cursor-grabbing touch-none shrink-0"
          >
            {/* Base Image with transforms applied */}
            <div
              className="absolute top-1/2 left-1/2 will-change-transform flex items-center justify-center"
              style={{
                transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) rotate(${rotation}deg) scale(${zoom})`,
                transformOrigin: 'center center',
              }}
            >
              <img
                ref={imageRef}
                src={imageSrc}
                alt="Source preview"
                onLoad={handleImageLoad}
                crossOrigin={imageSrc.startsWith('http://') || imageSrc.startsWith('https://') ? 'anonymous' : undefined}
                className="max-w-none pointer-events-none select-none"
                style={{
                  width: isLandscape ? 'auto' : '280px',
                  height: isLandscape ? '280px' : 'auto',
                  minWidth: '240px',
                  minHeight: '240px',
                  objectFit: 'cover',
                  display: 'block',
                }}
                draggable={false}
              />
            </div>

            {/* Circular Avatar / Card Framing Mask & Rule of Thirds Grid */}
            <div className="absolute inset-0 pointer-events-none">
              {/* Dark Vignette outside circular target */}
              <div
                className="w-full h-full"
                style={{
                  boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.55)',
                  borderRadius: '50%',
                }}
              />

              {/* Circular Boundary Ring */}
              <div className="absolute inset-0 rounded-full border border-white/40 shadow-sm" />

              {/* Subtle Grid Guidelines */}
              <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-25">
                <div className="border-r border-b border-white" />
                <div className="border-r border-b border-white" />
                <div className="border-b border-white" />
                <div className="border-r border-b border-white" />
                <div className="border-r border-b border-white" />
                <div className="border-b border-white" />
                <div className="border-r border-white" />
                <div className="border-r border-white" />
                <div />
              </div>
            </div>

            {/* Drag Hint Badge */}
            <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md text-[10px] text-white/80 font-medium flex items-center gap-1 pointer-events-none">
              <Move className="h-3 w-3" />
              Drag to frame
            </div>
          </div>

          {/* Controls Bar */}
          <div className="w-full max-w-sm flex flex-col gap-2.5">
            {/* Zoom Slider */}
            <div className="flex items-center gap-2.5 bg-theme-background/50 px-3 py-2 rounded-xl border border-theme-card-border">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(z - 0.15, 0.8))}
                className="p-1 text-theme-text-secondary hover:text-theme-text-primary rounded hover:bg-white/5 cursor-pointer transition-colors"
                title="Zoom Out"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <input
                type="range"
                min="0.8"
                max="3.5"
                step="0.05"
                value={zoom}
                onChange={(e) => setZoom(parseFloat(e.target.value))}
                className="flex-1 accent-accent h-1.5 bg-theme-card-border rounded-lg cursor-pointer"
              />
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(z + 0.15, 3.5))}
                className="p-1 text-theme-text-secondary hover:text-theme-text-primary rounded hover:bg-white/5 cursor-pointer transition-colors"
                title="Zoom In"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
              <span className="text-xs font-mono font-medium text-theme-text-secondary w-10 text-right">
                {Math.round(zoom * 100)}%
              </span>
            </div>

            {/* Quick Actions & Live Mini Preview */}
            <div className="flex items-center justify-between gap-3 pt-0.5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={rotate90}
                  className="px-3 py-1.5 rounded-xl bg-theme-card-border/40 hover:bg-theme-card-border border border-theme-card-border text-xs font-medium text-theme-text-primary flex items-center gap-1.5 cursor-pointer transition-colors"
                  title="Rotate 90 degrees"
                >
                  <RotateCw className="h-3.5 w-3.5" />
                  Rotate
                </button>
                <button
                  type="button"
                  onClick={resetTransforms}
                  className="px-3 py-1.5 rounded-xl bg-theme-card-border/40 hover:bg-theme-card-border border border-theme-card-border text-xs font-medium text-theme-text-secondary hover:text-theme-text-primary flex items-center gap-1.5 cursor-pointer transition-colors"
                  title="Reset alignment"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Reset
                </button>
              </div>

              {/* Side-by-side Mini Previews (Circular Avatar & Card Badge) */}
              <div className="flex items-center gap-2">
                <div className="text-right">
                  <p className="text-[9px] uppercase tracking-wider font-semibold text-theme-text-secondary">Preview</p>
                </div>
                {/* Circular preview */}
                <div
                  className="h-8 w-8 sm:h-9 sm:w-9 rounded-full overflow-hidden border-2 border-accent/60 bg-neutral-900 shadow-md flex items-center justify-center shrink-0"
                  title="Avatar framing"
                >
                  <canvas ref={miniCanvasRef} className="h-full w-full object-cover" />
                </div>
                {/* Card-rounded preview */}
                <div
                  className="h-8 w-8 sm:h-9 sm:w-9 rounded-xl overflow-hidden border border-white/20 bg-neutral-900 shadow-md flex items-center justify-center shrink-0"
                  title="Visiting Card badge framing"
                >
                  <canvas ref={miniCardCanvasRef} className="h-full w-full object-cover" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-3.5 sm:p-4 border-t border-theme-card-border flex items-center justify-end gap-3 bg-theme-header-bg/50 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            className="px-4 py-2 rounded-xl text-sm font-medium text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-card-border/50 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApplyCrop}
            disabled={isProcessing}
            className="px-5 py-2 rounded-xl bg-accent hover:bg-accent/90 text-white font-medium text-sm shadow-md flex items-center gap-2 cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isProcessing ? (
              <>
                <span className="h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                Apply & Use Photo
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ImageCropModal;