'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
// @ts-ignore
import jsQR from 'jsqr';
import {
  QrCode,
  Search,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Camera,
  CameraOff,
  RefreshCw,
  Zap,
  ZapOff,
  Clock,
  MapPin,
  Sparkles,
  Calendar,
  Check,
  Plus,
} from 'lucide-react';
import {
  EventPassItem,
  getEventPasses,
  saveEventPasses,
  getPassValidDays,
  formatValidDaysLabel,
  todayIso,
  authHeaders,
} from '@/lib/local-data';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** "2026-10-11" -> "Sun 11 Oct"; custom labels pass through. */
function dayLabel(day: string): string {
  if (!ISO_DAY.test(day)) return day;
  return new Date(`${day}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

interface EventPassScannerProps {
  currentUserName: string;
  onPassCheckedIn?: (pass: EventPassItem) => void;
}

export function EventPassScanner({
  currentUserName,
  onPassCheckedIn,
}: EventPassScannerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<{
    valid: boolean;
    pass?: EventPassItem;
    status?: string;
    isAlreadyCheckedIn?: boolean;
    reason?: string;
  } | null>(null);
  const [checkInError, setCheckInError] = useState('');

  const [checkInSuccess, setCheckInSuccess] = useState(false);

  // Multi-day Attendance State
  const [availableDays, setAvailableDays] = useState<string[]>([]);
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [customDayInput, setCustomDayInput] = useState('');
  const [showAddCustomDay, setShowAddCustomDay] = useState(false);

  // Live Camera State
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraFacingMode, setCameraFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState('');
  const [torchOn, setTorchOn] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [lastScannedFeedback, setLastScannedFeedback] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastScannedRef = useRef<{ code: string; time: number }>({ code: '', time: 0 });
  const animationFrameRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Cleanly stop all active video tracks
  const stopCamera = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (e) {}
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
    setTorchOn(false);
    setHasTorch(false);
  }, []);

  // Play a crisp audio beep on successful QR read
  const playBeep = () => {
    if (typeof window === 'undefined') return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 note
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch (e) {}
  };

  const handleVerify = useCallback(async (queryToUse?: string) => {
    const q = (queryToUse || searchQuery).trim();
    if (!q) return;

    setIsVerifying(true);
    setVerificationResult(null);
    setCheckInSuccess(false);
    setCheckInError('');

    try {
      const res = await fetch('/api/events/all/passes', {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ query: q }),
      });

      const data = await res.json();
      if (res.ok && data.valid) {
        setVerificationResult({
          valid: true,
          pass: data.pass,
          status: data.status,
          isAlreadyCheckedIn: data.isAlreadyCheckedIn,
        });
      } else {
        setVerificationResult({
          valid: false,
          reason: data.reason || data.error || 'Invalid or unrecognized event pass.',
        });
      }
    } catch (err: any) {
      setVerificationResult({
        valid: false,
        reason: 'Verification request failed. Please check network connection.',
      });
    } finally {
      setIsVerifying(false);
    }
  }, [searchQuery]);

  // Parse scanned raw value (JSON payload, URL param, or direct serial)
  const handleScannedValue = useCallback((raw: string) => {
    const now = Date.now();
    // 2.5 second cooldown per identical scan to avoid rapid duplicate triggers
    if (lastScannedRef.current.code === raw && now - lastScannedRef.current.time < 2500) {
      return;
    }

    lastScannedRef.current = { code: raw, time: now };

    // Haptic & Visual feedback
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate([100, 40, 100]);
      } catch (e) {}
    }
    playBeep();
    setLastScannedFeedback(true);
    setTimeout(() => setLastScannedFeedback(false), 800);

    let parsedQuery = raw.trim();

    // Check if it's a JSON string
    if (parsedQuery.startsWith('{') && parsedQuery.endsWith('}')) {
      try {
        const json = JSON.parse(parsedQuery);
        if (json.serial) parsedQuery = json.serial;
        else if (json.passId) parsedQuery = json.passId;
      } catch (e) {}
    } else if (/^https?:\/\//i.test(parsedQuery)) {
      // Handle a scanned pass URL, e.g. https://.../pass/LEADS-EVT-XXXX or ?pass=LEADS-EVT-XXXX
      try {
        const url = new URL(parsedQuery);
        const queryParam = url.searchParams.get('pass');
        if (queryParam) {
          parsedQuery = decodeURIComponent(queryParam);
        } else {
          const segments = url.pathname.split('/').filter(Boolean);
          const passIndex = segments.indexOf('pass');
          const serialSegment = passIndex !== -1 ? segments[passIndex + 1] : segments[segments.length - 1];
          if (serialSegment) parsedQuery = decodeURIComponent(serialSegment);
        }
      } catch (e) {}
    }

    setSearchQuery(parsedQuery);
    handleVerify(parsedQuery);
  }, [handleVerify]);

  // Frame scanning engine (Canvas jsQR + BarcodeDetector fallback)
  const processFrame = useCallback(() => {
    if (!videoRef.current || videoRef.current.readyState < 2) {
      animationFrameRef.current = requestAnimationFrame(processFrame);
      return;
    }

    const video = videoRef.current;
    const w = video.videoWidth;
    const h = video.videoHeight;

    if (w > 0 && h > 0) {
      if (!canvasRef.current) {
        canvasRef.current = document.createElement('canvas');
      }
      const canvas = canvasRef.current;
      // Downscale slightly for ultra-fast 60fps QR analysis
      const maxDim = 640;
      let targetW = w;
      let targetH = h;
      if (targetW > maxDim) {
        targetW = maxDim;
        targetH = Math.round((h / w) * maxDim);
      }
      canvas.width = targetW;
      canvas.height = targetH;

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0, targetW, targetH);
        try {
          const imageData = ctx.getImageData(0, 0, targetW, targetH);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'attemptBoth',
          });
          if (code && code.data && code.data.trim()) {
            handleScannedValue(code.data.trim());
          }
        } catch (e) {}
      }
    }

    animationFrameRef.current = requestAnimationFrame(processFrame);
  }, [handleScannedValue]);

  // Start Camera Stream
  const startCamera = async (facing: 'environment' | 'user' = cameraFacingMode) => {
    stopCamera();
    setCameraError('');

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera access is not supported on this browser or environment.');
      return;
    }

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      setIsCameraActive(true);

      // Check for torch & multi-camera availability
      const track = stream.getVideoTracks()[0];
      if (track) {
        const capabilities: any = track.getCapabilities ? track.getCapabilities() : {};
        if (capabilities.torch) setHasTorch(true);
      }

      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      const videoInputs = devices.filter((d) => d.kind === 'videoinput');
      if (videoInputs.length > 1) setHasMultipleCameras(true);

      // Bind to video element once mounted
      setTimeout(() => {
        if (videoRef.current && streamRef.current) {
          videoRef.current.srcObject = streamRef.current;
          videoRef.current.setAttribute('playsinline', 'true');
          videoRef.current.setAttribute('webkit-playsinline', 'true');
          videoRef.current.muted = true;
          videoRef.current.play().catch((e) => console.warn('Video play deferred:', e));
          // Start frame detection loop
          if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = requestAnimationFrame(processFrame);
        }
      }, 50);
    } catch (err: any) {
      console.error('Camera access error:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setCameraError('Camera permission was denied. Please allow camera permissions in your browser/system settings.');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setCameraError('No camera found on this device.');
      } else {
        setCameraError('Unable to start camera stream. Please check camera permissions.');
      }
      setIsCameraActive(false);
    }
  };

  // Ensure stream binds whenever video mounts
  useEffect(() => {
    if (isCameraActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.setAttribute('playsinline', 'true');
      videoRef.current.setAttribute('webkit-playsinline', 'true');
      videoRef.current.muted = true;
      videoRef.current.play().catch(() => {});
      if (!animationFrameRef.current) {
        animationFrameRef.current = requestAnimationFrame(processFrame);
      }
    }
  }, [isCameraActive, processFrame]);

  const toggleTorch = async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;

    try {
      const nextState = !torchOn;
      await (track as any).applyConstraints({
        advanced: [{ torch: nextState }],
      });
      setTorchOn(nextState);
    } catch (err) {
      console.warn('Torch toggle failed:', err);
    }
  };

  const switchCamera = () => {
    const nextFacing = cameraFacingMode === 'environment' ? 'user' : 'environment';
    setCameraFacingMode(nextFacing);
    startCamera(nextFacing);
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  // Synchronize available days & selected days whenever a pass is verified.
  // Structured passes use their own validDays (one pass, one QR, many days); legacy passes fall back to Day 1-3.
  useEffect(() => {
    if (verificationResult?.pass) {
      const pass = verificationResult.pass;
      const validDays = getPassValidDays(pass);
      const daysSet = new Set<string>(validDays);
      (pass.attendance || []).forEach((a) => {
        if (a.day) daysSet.add(a.day);
      });
      if (validDays.length === 0) ['Day 1', 'Day 2', 'Day 3'].forEach((d) => daysSet.add(d));

      const daysList = Array.from(daysSet);
      setAvailableDays(daysList);

      const attendedSet = new Set((pass.attendance || []).map((a) => a.day.toLowerCase()));
      if (validDays.length > 0) {
        const today = todayIso();
        setSelectedDays(validDays.includes(today) && !attendedSet.has(today) ? [today] : []);
      } else {
        const firstUnattended = daysList.find((d) => !attendedSet.has(d.toLowerCase()));
        setSelectedDays(firstUnattended ? [firstUnattended] : []);
      }
    } else {
      setSelectedDays([]);
    }
  }, [verificationResult?.pass?.id]);

  const handleCheckInDays = async (daysToCheckIn: string[]) => {
    if (!verificationResult?.pass || daysToCheckIn.length === 0) return;
    setCheckInError('');
    try {
      const res = await fetch('/api/events/all/passes/checkin', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ passId: verificationResult.pass.id, days: daysToCheckIn }),
      });
      const data = await res.json();
      if (!res.ok || !data.pass) {
        setCheckInError(data.error || 'Check-in failed.');
        return;
      }
      const updated: EventPassItem = data.pass;
      // Keep this device's cache in step with the server copy
      const cached = getEventPasses();
      const idx = cached.findIndex((p) => p.id === updated.id);
      if (idx >= 0) {
        cached[idx] = updated;
        saveEventPasses(cached);
      }
      setVerificationResult({
        ...verificationResult,
        pass: updated,
        status: updated.status,
        isAlreadyCheckedIn: true,
      });
      setCheckInSuccess(true);
      setSelectedDays([]);
      if (onPassCheckedIn) onPassCheckedIn(updated);
    } catch {
      setCheckInError('Check-in request failed. Please check network connection.');
    }
  };

  const handleAddCustomDay = () => {
    const trimmed = customDayInput.trim();
    if (!trimmed) return;
    if (!availableDays.some((d) => d.toLowerCase() === trimmed.toLowerCase())) {
      setAvailableDays((prev) => [...prev, trimmed]);
    }
    if (!selectedDays.some((d) => d.toLowerCase() === trimmed.toLowerCase())) {
      setSelectedDays((prev) => [...prev, trimmed]);
    }
    setCustomDayInput('');
    setShowAddCustomDay(false);
  };

  const handleCheckIn = () => {
    if (!verificationResult?.pass) return;
    handleCheckInDays(selectedDays);
  };

  return (
    <div className="glass-panel rounded-3xl p-6 md:p-8 space-y-6 border border-slate-200/90 dark:border-white/15 bg-white/95 dark:bg-[#0D1F38]/95 shadow-2xl max-w-2xl mx-auto text-xs">
      <div className="flex items-center justify-between border-b border-slate-200/80 dark:border-white/10 pb-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-sky-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400">
            <QrCode className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-black text-slate-900 dark:text-white">
              Turnstile Camera &amp; QR Scanner
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
              Scan passes via smartphone camera or enter serial ID for instant admission.
            </p>
          </div>
        </div>

        {/* Live Camera Scanner Button */}
        <button
          type="button"
          onClick={() => (isCameraActive ? stopCamera() : startCamera())}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shadow-md ${
            isCameraActive
              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30'
              : 'bg-accent text-white hover:bg-accent/90 shadow-accent/25'
          }`}
        >
          {isCameraActive ? (
            <>
              <CameraOff className="h-4 w-4" /> Stop Camera
            </>
          ) : (
            <>
              <Camera className="h-4 w-4" /> Open Camera Scanner
            </>
          )}
        </button>
      </div>

      {/* CAMERA ERROR BANNER */}
      {cameraError && (
        <div className="p-4 bg-rose-500/15 border border-rose-500/30 rounded-2xl text-rose-300 text-xs flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-rose-400 shrink-0" />
          <span>{cameraError}</span>
        </div>
      )}

      {/* LIVE CAMERA VIEWFINDER WITH HUD & RETICLE */}
      {isCameraActive && (
        <div className={`relative w-full aspect-[4/3] max-h-80 rounded-2xl overflow-hidden bg-black border-2 transition-colors duration-200 shadow-2xl ${
          lastScannedFeedback ? 'border-emerald-400 ring-4 ring-emerald-400/40' : 'border-accent'
        }`}>
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            onLoadedMetadata={() => {
              if (videoRef.current) {
                videoRef.current.play().catch(() => {});
              }
            }}
            className="w-full h-full object-cover"
          />

          {/* Top Camera Controls Overlay */}
          <div className="absolute top-3 left-3 right-3 flex items-center justify-between z-20">
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-black/70 text-white border border-white/20 backdrop-blur-md flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${lastScannedFeedback ? 'bg-emerald-400 scale-125' : 'bg-emerald-400 animate-ping'}`} />
              {lastScannedFeedback ? 'Pass Scanned!' : 'Scanning Turnstile QR'}
            </span>

            <div className="flex items-center gap-1.5">
              {hasTorch && (
                <button
                  type="button"
                  onClick={toggleTorch}
                  className={`p-2 rounded-xl backdrop-blur-md border transition-all cursor-pointer ${
                    torchOn
                      ? 'bg-amber-500 text-black border-amber-400 shadow-lg shadow-amber-500/40'
                      : 'bg-black/60 text-white border-white/20 hover:bg-black/80'
                  }`}
                  title="Toggle Flashlight / Torch"
                >
                  {torchOn ? <Zap className="h-4 w-4" /> : <ZapOff className="h-4 w-4" />}
                </button>
              )}

              {hasMultipleCameras && (
                <button
                  type="button"
                  onClick={switchCamera}
                  className="p-2 rounded-xl bg-black/60 text-white border border-white/20 hover:bg-black/80 backdrop-blur-md transition-all cursor-pointer"
                  title="Switch Front/Back Camera"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {/* Viewfinder Target Reticle */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div className={`relative w-48 h-48 sm:w-56 sm:h-56 rounded-2xl border-2 transition-all duration-300 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] ${
              lastScannedFeedback ? 'border-emerald-400 bg-emerald-400/10' : 'border-white/40'
            }`}>
              {/* Corner brackets */}
              <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-accent rounded-tl-lg" />
              <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-accent rounded-tr-lg" />
              <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-accent rounded-bl-lg" />
              <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-accent rounded-br-lg" />

              {/* Animated Laser Scanning Line */}
              <div className="absolute left-2 right-2 h-0.5 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_#38bdf8] animate-[bounce_2s_infinite]" />
            </div>
          </div>

          {/* Bottom Hint */}
          <div className="absolute bottom-3 inset-x-0 text-center z-20">
            <span className="text-[10px] font-semibold text-white/90 bg-black/60 px-3 py-1 rounded-full backdrop-blur-md border border-white/10">
              Align event pass QR code within the target
            </span>
          </div>
        </div>
      )}

      {/* MANUAL SEARCH / SCAN INPUT (FOR HANDHELD GUNS OR SERIAL ENTRY) */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleVerify();
        }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Scan barcode/QR payload or enter serial ID (e.g. LEADS-EVT-2026-XXXX)"
            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-300 dark:border-white/15 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 font-medium focus:outline-none focus:border-accent text-xs"
          />
        </div>
        <button
          type="submit"
          disabled={isVerifying || !searchQuery.trim()}
          className="px-5 py-2.5 bg-accent hover:bg-accent/90 text-white font-extrabold rounded-xl transition-all shadow-md shadow-accent/25 flex items-center gap-2 cursor-pointer disabled:opacity-50 text-xs uppercase tracking-wider"
        >
          {isVerifying ? (
            <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            'Verify Pass'
          )}
        </button>
      </form>

      {/* VERIFICATION RESULT CARD */}
      {verificationResult && (
        <div className="animate-in fade-in zoom-in-95 duration-200">
          {verificationResult.valid && verificationResult.pass ? (() => {
            const pass = verificationResult.pass;
            const attendance = pass.attendance || [];
            const attendedMap = new Map(attendance.map((a) => [a.day.toLowerCase(), a]));
            const validDays = getPassValidDays(pass);
            const isStructured = validDays.length > 0;
            const today = todayIso();
            const isCancelled = pass.status === 'Cancelled';
            const pendingDays = availableDays.filter((d) => !attendedMap.has(d.toLowerCase()));
            // Structured passes can only be checked in on the day itself
            const isDayOpen = (d: string) => !isStructured || d === today;
            const checkableDays = pendingDays.filter(isDayOpen);
            const validToday = !isStructured || validDays.includes(today);
            const isAllAttended = availableDays.length > 0 && pendingDays.length === 0;

            if (isCancelled) {
              return (
                <div className="p-6 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-center gap-3">
                  <XCircle className="h-6 w-6 text-rose-400 shrink-0" />
                  <div>
                    <div className="font-bold text-rose-200">Pass Cancelled — Do Not Admit</div>
                    <div className="text-xs text-rose-300/80">
                      {pass.attendeeName} · {pass.serialNumber}
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div
                className={`p-6 rounded-2xl border space-y-4 ${
                  isAllAttended
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                    : attendance.length > 0
                    ? 'bg-sky-500/10 border-sky-500/30 text-sky-200'
                    : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                }`}
              >
                {/* Header Status */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {isAllAttended ? (
                      <>
                        <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                        <span className="font-bold text-emerald-300 text-sm">
                          {checkInSuccess ? 'Checked In Successfully!' : 'Pass Fully Checked In (All Days Attended)'}
                        </span>
                      </>
                    ) : attendance.length > 0 ? (
                      <>
                        <Clock className="h-5 w-5 text-sky-400 shrink-0" />
                        <span className="font-bold text-sky-300 text-sm">
                          {checkInSuccess
                            ? 'Checked In Successfully!'
                            : `Partially Attended (${attendance.length}/${availableDays.length} Days)`}
                        </span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                        <span className="font-bold text-emerald-300 text-sm">
                          {validToday ? 'Genuine & Verified Pass' : `Genuine pass — not valid today (${formatValidDaysLabel(validDays)})`}
                        </span>
                      </>
                    )}
                  </div>
                  <span className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-black/40 border border-white/10 text-white font-bold">
                    {pass.serialNumber}
                  </span>
                </div>

                {/* Attendee Info Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-xl bg-black/30 border border-white/10 text-white">
                  <div className="space-y-0.5">
                    <span className="text-[9px] text-slate-400 uppercase tracking-wider block font-semibold">Attendee</span>
                    <span className="text-sm font-extrabold block">{pass.attendeeName}</span>
                    {pass.guestCategory && (
                      <span className="inline-block text-[9.5px] font-bold px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30 mt-0.5">
                        {pass.guestCategory}
                      </span>
                    )}
                  </div>

                  <div className="space-y-0.5">
                    <span className="text-[9px] text-slate-400 uppercase tracking-wider block font-semibold">Assigned Room / Venue</span>
                    <span className="text-xs font-bold text-sky-300 flex items-start gap-1 min-w-0">
                      <MapPin className="h-3 w-3 text-sky-400 shrink-0 mt-0.5" />
                      <span className="min-w-0 break-words [overflow-wrap:anywhere]">{pass.roomOrVenue || pass.eventVenue || 'Main Auditorium'}</span>
                    </span>
                    <span className="text-[10.5px] text-slate-300 block">
                      Tier: {pass.passType}
                    </span>
                  </div>

                  <div className="space-y-0.5 pt-2 border-t border-white/10">
                    <span className="text-[9px] text-slate-400 uppercase tracking-wider block font-semibold">Event</span>
                    <span className="text-xs font-semibold block truncate">{pass.eventName}</span>
                  </div>

                  <div className="space-y-0.5 pt-2 border-t border-white/10">
                    <span className="text-[9px] text-slate-400 uppercase tracking-wider block font-semibold">Validity / Issued</span>
                    <span className="text-xs text-slate-300 block">
                      {isStructured ? formatValidDaysLabel(validDays) : pass.validityDate || pass.eventDate || '2026'}
                    </span>
                  </div>
                </div>

                {/* Multi-Day Attendance Roster & Check-In */}
                <div className="space-y-3 p-4 rounded-xl bg-black/40 border border-white/10 text-white">
                  <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-sky-400" />
                      <span className="font-extrabold text-xs text-white">
                        Multi-Day Attendance Roster
                      </span>
                    </div>
                    <span
                      className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                        isAllAttended
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : attendance.length > 0
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : 'bg-slate-500/20 text-slate-300 border border-slate-500/30'
                      }`}
                    >
                      {attendance.length} of {availableDays.length} Days Attended
                    </span>
                  </div>

                  {/* Day Cards List */}
                  <div className="space-y-2">
                    {availableDays.map((day) => {
                      const record = attendedMap.get(day.toLowerCase());
                      const isAttended = !!record;
                      const isSelected = selectedDays.includes(day);

                      if (isAttended) {
                        return (
                          <div
                            key={day}
                            className="flex items-center justify-between p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300"
                          >
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                              <span className="font-extrabold text-xs text-white">{dayLabel(day)}</span>
                              <span className="text-[9.5px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-semibold">
                                Attended
                              </span>
                            </div>
                            <div className="text-[10px] text-emerald-300/90 flex items-center gap-1 font-medium">
                              <Clock className="h-3 w-3 shrink-0" />
                              <span>
                                {new Date(record.timestamp).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}{' '}
                                by {record.scannedBy || record.checkedInBy || 'Staff'}
                              </span>
                            </div>
                          </div>
                        );
                      }

                      if (!isDayOpen(day)) {
                        return (
                          <div
                            key={day}
                            className="w-full flex items-center justify-between p-2.5 rounded-xl border border-white/5 bg-white/[0.03] text-slate-500"
                          >
                            <span className="font-bold text-xs">{dayLabel(day)}</span>
                            <span className="text-[10px] font-medium">{day < today ? 'Missed' : 'Not yet — valid on this date'}</span>
                          </div>
                        );
                      }

                      return (
                        <button
                          type="button"
                          key={day}
                          onClick={() => {
                            setSelectedDays((prev) =>
                              prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
                            );
                          }}
                          className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                            isSelected
                              ? 'bg-sky-500/25 border-sky-400 text-white shadow-md ring-1 ring-sky-400/40'
                              : 'bg-white/5 border-white/10 hover:border-white/25 text-slate-300'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <div
                              className={`h-4 w-4 rounded-md border flex items-center justify-center transition-all ${
                                isSelected ? 'bg-sky-500 border-sky-400 text-white' : 'border-white/30'
                              }`}
                            >
                              {isSelected && <Check className="h-3 w-3 stroke-[3]" />}
                            </div>
                            <span className="font-bold text-xs">{dayLabel(day)}</span>
                          </div>
                          <span className="text-[10px] text-slate-400 font-medium">
                            {isSelected ? 'Selected for check-in' : 'Click to select'}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Add Custom Day or Session */}
                  <div className="pt-1">
                    {isStructured ? null : !showAddCustomDay ? (
                      <button
                        type="button"
                        onClick={() => setShowAddCustomDay(true)}
                        className="text-[10.5px] text-sky-400 hover:text-sky-300 flex items-center gap-1 font-bold cursor-pointer transition-colors"
                      >
                        <Plus className="h-3.5 w-3.5" /> Add Day / Custom Session
                      </button>
                    ) : (
                      <div className="flex gap-2 items-center">
                        <input
                          type="text"
                          value={customDayInput}
                          onChange={(e) => setCustomDayInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddCustomDay();
                            }
                          }}
                          placeholder="e.g. Day 4, Gala Dinner, Afternoon Session"
                          className="flex-1 px-3 py-1.5 bg-black/50 border border-white/20 rounded-lg text-white text-xs placeholder-slate-400 focus:outline-none focus:border-sky-400"
                        />
                        <button
                          type="button"
                          onClick={handleAddCustomDay}
                          disabled={!customDayInput.trim()}
                          className="px-3 py-1.5 bg-sky-500 hover:bg-sky-400 text-white text-xs font-bold rounded-lg cursor-pointer disabled:opacity-50"
                        >
                          Add
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowAddCustomDay(false);
                            setCustomDayInput('');
                          }}
                          className="px-2.5 py-1.5 text-slate-400 hover:text-white text-xs cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Multi-Day Check-In Trigger Buttons */}
                  <div className="pt-2 flex flex-col sm:flex-row gap-2">
                    {checkableDays.length > 0 ? (
                      <>
                        <button
                          type="button"
                          disabled={selectedDays.length === 0}
                          onClick={() => handleCheckInDays(selectedDays)}
                          className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold rounded-xl transition-all shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 cursor-pointer text-xs uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          {selectedDays.length > 1
                            ? `Check In ${selectedDays.length} Days Simultaneously`
                            : selectedDays.length === 1
                            ? `Check In ${dayLabel(selectedDays[0])}`
                            : 'Select Day(s) to Check In'}
                        </button>

                        {!isStructured && pendingDays.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleCheckInDays(pendingDays)}
                            className="py-3 px-4 bg-sky-600/20 hover:bg-sky-600/30 text-sky-200 border border-sky-500/40 font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer text-xs uppercase tracking-wider"
                            title="Mark all remaining days attended at once"
                          >
                            Check In All Remaining ({pendingDays.length} Days)
                          </button>
                        )}
                      </>
                    ) : isStructured && pendingDays.length > 0 ? (
                      <div className="w-full py-2.5 px-4 bg-amber-500/15 border border-amber-500/30 text-amber-200 font-bold rounded-xl text-xs flex items-center justify-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-400" />
                        {validToday ? 'Already checked in for today' : 'This pass is not valid today — no check-in possible'}
                      </div>
                    ) : (
                      <div className="w-full py-2.5 px-4 bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 font-extrabold rounded-xl text-xs flex items-center justify-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        Pass Checked In for All Registered Days
                      </div>
                    )}
                  </div>
                  {checkInError && (
                    <div className="text-xs font-semibold text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
                      {checkInError}
                    </div>
                  )}
                </div>
              </div>
            );
          })() : (
            <div className="p-6 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 space-y-2 flex items-center gap-3">
              <XCircle className="h-6 w-6 text-rose-400 shrink-0" />
              <div>
                <div className="font-bold text-rose-200">Verification Failed</div>
                <div className="text-xs text-rose-300/80">{verificationResult.reason}</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default EventPassScanner;
