'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  Phone,
  Mail,
  Download,
  Wallet,
  AlertCircle,
  QrCode,
  Sparkles,
  Smartphone,
  ShieldCheck,
} from 'lucide-react';
import { Linkedin } from '@/components/ui/linkedin-icon';
import { saveContactToPhone } from '@/lib/save-contact';
import { resolveCustomLinkIcon } from '@/lib/custom-link-icons';
import styles from './profile-card.module.css';

export interface ProfileCardCustomLink {
  label: string;
  url: string;
  icon: string;
  customIconUrl?: string;
  customIconData?: string;
}

export interface ProfileCardProps {
  name: string;
  title?: string;
  handle?: string;
  status?: string;
  contactText?: string;
  avatarUrl?: string;
  showUserInfo?: boolean;
  showActions?: boolean;
  enableTilt?: boolean;
  enableMobileTilt?: boolean;
  behindGlowEnabled?: boolean;
  innerGradient?: string;
  phone?: string;
  email?: string;
  linkedin?: string;
  customLinks?: ProfileCardCustomLink[];
  slug?: string;
  appleWalletAvailable?: boolean;
  googleWalletAvailable?: boolean;
  isOpeningAppleWallet?: boolean;
  isOpeningGoogleWallet?: boolean;
  walletError?: string;
  onContactClick?: () => void;
  onAppleWalletClick?: () => void;
  onGoogleWalletClick?: () => void;
  onShowQr?: () => void;
}

export function ProfileCard({
  name,
  title = 'Executive Member',
  handle = 'rtbi.msruas',
  status = 'Verified Member',
  contactText = 'Save Contact',
  avatarUrl,
  showUserInfo = true,
  showActions = true,
  enableTilt = true,
  enableMobileTilt = true,
  behindGlowEnabled = true,
  innerGradient = 'linear-gradient(145deg, rgba(96,73,110,0.45) 0%, rgba(113,196,255,0.22) 100%)',
  phone,
  email,
  linkedin,
  customLinks,
  slug,
  appleWalletAvailable = false,
  googleWalletAvailable = false,
  isOpeningAppleWallet = false,
  isOpeningGoogleWallet = false,
  walletError = '',
  onContactClick,
  onAppleWalletClick,
  onGoogleWalletClick,
  onShowQr,
}: ProfileCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [transformStyle, setTransformStyle] = useState('');
  const [glareStyle, setGlareStyle] = useState<{ x: string; y: string; opacity: number }>({
    x: '50%',
    y: '50%',
    opacity: 0,
  });
  const [gyroActive, setGyroActive] = useState(false);
  const [needsIosPermission, setNeedsIosPermission] = useState(false);
  const isTouchingRef = useRef(false);

  // Desktop Pointer / Mouse Tilt
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!enableTilt || !cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const rotateX = ((y - centerY) / centerY) * -14;
    const rotateY = ((x - centerX) / centerX) * 14;

    const glareX = `${(x / rect.width) * 100}%`;
    const glareY = `${(y / rect.height) * 100}%`;

    setTransformStyle(`perspective(1000px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) scale3d(1.02, 1.02, 1.02)`);
    setGlareStyle({ x: glareX, y: glareY, opacity: 0.75 });
  };

  const handleMouseLeave = () => {
    if (!enableTilt) return;
    setTransformStyle('perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)');
    setGlareStyle((prev) => ({ ...prev, opacity: 0 }));
  };

  // Mobile Touch Move Tilt (Finger Swipe / Drag Physics)
  const handleTouchStart = () => {
    isTouchingRef.current = true;
    // On iOS Safari, user tap allows requesting device orientation permission
    if (needsIosPermission) {
      enableIosGyroscope();
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!enableTilt || !cardRef.current || e.touches.length === 0) return;
    const touch = e.touches[0];
    const rect = cardRef.current.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;

    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const rotateX = ((y - centerY) / centerY) * -16;
    const rotateY = ((x - centerX) / centerX) * 16;

    const glareX = `${Math.max(0, Math.min(100, (x / rect.width) * 100))}%`;
    const glareY = `${Math.max(0, Math.min(100, (y / rect.height) * 100))}%`;

    setTransformStyle(`perspective(1000px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) scale3d(1.03, 1.03, 1.03)`);
    setGlareStyle({ x: glareX, y: glareY, opacity: 0.8 });
  };

  const handleTouchEnd = () => {
    isTouchingRef.current = false;
    setTimeout(() => {
      if (!isTouchingRef.current && !gyroActive) {
        setTransformStyle('perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)');
        setGlareStyle((prev) => ({ ...prev, opacity: 0 }));
      }
    }, 400);
  };

  // Gyroscope orientation listener
  const handleOrientation = useCallback((event: DeviceOrientationEvent) => {
    if (isTouchingRef.current) return; // Touch drag takes precedence
    const gamma = event.gamma; // Left to right [-90, 90]
    const beta = event.beta; // Front to back [-180, 180]

    if (gamma === null || beta === null) return;
    setGyroActive(true);

    // Clamp angles for comfortable hand-held tilting
    const clampedGamma = Math.max(-35, Math.min(35, gamma));
    const clampedBeta = Math.max(10, Math.min(80, beta)) - 45; // baseline holding angle at 45 deg

    const rotateY = (clampedGamma / 35) * 18;
    const rotateX = -(clampedBeta / 35) * 18;

    const glareX = `${50 + (clampedGamma / 35) * 45}%`;
    const glareY = `${50 + (clampedBeta / 35) * 45}%`;

    setTransformStyle(
      `perspective(1000px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) scale3d(1.01, 1.01, 1.01)`
    );
    setGlareStyle({ x: glareX, y: glareY, opacity: 0.55 });
  }, []);

  // iOS Safari Permission Request
  const enableIosGyroscope = async () => {
    if (
      typeof window !== 'undefined' &&
      typeof (window as any).DeviceOrientationEvent !== 'undefined' &&
      typeof (window as any).DeviceOrientationEvent.requestPermission === 'function'
    ) {
      try {
        const state = await (window as any).DeviceOrientationEvent.requestPermission();
        if (state === 'granted') {
          setNeedsIosPermission(false);
          setGyroActive(true);
          window.addEventListener('deviceorientation', handleOrientation, true);
        }
      } catch (err) {
        console.warn('Device orientation permission dismissed:', err);
      }
    }
  };

  useEffect(() => {
    if (!enableMobileTilt || typeof window === 'undefined') return;

    // Check if browser requires explicit permission (iOS 13+)
    if (
      typeof (window as any).DeviceOrientationEvent !== 'undefined' &&
      typeof (window as any).DeviceOrientationEvent.requestPermission === 'function'
    ) {
      setNeedsIosPermission(true);
    } else if ('DeviceOrientationEvent' in window) {
      // Standard Android / non-iOS browser: auto-bind
      window.addEventListener('deviceorientation', handleOrientation, true);
    }

    return () => {
      window.removeEventListener('deviceorientation', handleOrientation, true);
    };
  }, [enableMobileTilt, handleOrientation]);

  const initials = (name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');

  return (
    <div className={styles.cardWrapper}>
      {behindGlowEnabled && <div className={styles.glowBehind} />}

      <div
        ref={cardRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={needsIosPermission ? enableIosGyroscope : undefined}
        className={styles.cardContainer}
        style={{
          transform: transformStyle || undefined,
        }}
      >
        {/* Dynamic Glare Highlight */}
        <div
          className={styles.cardGlare}
          style={
            {
              '--glare-x': glareStyle.x,
              '--glare-y': glareStyle.y,
              '--glare-opacity': glareStyle.opacity,
            } as React.CSSProperties
          }
        />

        {/* Custom Inner Gradient Layer */}
        <div className={styles.cardInnerGradient} style={{ background: innerGradient }} />

        {/* Card Content */}
        <div className={styles.cardContent}>
          {/* Executive Avatar Ring */}
          <div className={styles.avatarWrapper}>
            {avatarUrl ? (
              <img src={avatarUrl} alt={name} className={styles.avatarImage} />
            ) : (
              <div className={styles.avatarInitials}>{initials}</div>
            )}
            <span className={styles.statusIndicator} title={status} />
          </div>

          {/* User Info */}
          {showUserInfo && (
            <>
              <h1 className={styles.userName}>{name}</h1>
              {title && <p className={styles.userTitle}>{title}</p>}
              {handle && <p className={styles.userHandle}>@{handle.replace(/^@/, '')}</p>}

              <div className={styles.orgBadge}>
                <ShieldCheck className="h-3 w-3 text-sky-400" />
                <span>RTBI Portal</span>
              </div>
            </>
          )}

          {/* Contact Details */}
          {(phone || email) && (
            <div className={styles.contactGrid}>
              {phone && (
                <a href={`tel:${phone}`} className={styles.contactRow}>
                  <Phone className="h-3.5 w-3.5 text-sky-400" />
                  <span>{phone}</span>
                </a>
              )}
              {email && (
                <a href={`mailto:${email}`} className={styles.contactRow}>
                  <Mail className="h-3.5 w-3.5 text-sky-400" />
                  <span className="truncate max-w-[260px]">{email}</span>
                </a>
              )}
            </div>
          )}

          {/* LinkedIn Social Link */}
          {linkedin && (
            <div className="mt-3 flex items-center justify-center">
              <a
                href={linkedin}
                target="_blank"
                rel="noopener noreferrer"
                title="LinkedIn Profile"
                className="h-8 w-8 flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-sky-400 transition-colors"
              >
                <Linkedin className="h-3.5 w-3.5" />
              </a>
            </div>
          )}

          {/* Custom Links — icon + name shown together, unlike the icon-only LinkedIn button above */}
          {customLinks && customLinks.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
              {customLinks.map((link, idx) => {
                const iconSrc = link.customIconData || link.customIconUrl;
                const PresetIcon = resolveCustomLinkIcon(link.icon);
                return (
                  <a
                    key={idx}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={link.label}
                    className="flex items-center gap-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 px-2.5 py-1.5 text-[11px] font-medium text-white/90 transition-colors"
                  >
                    {iconSrc ? (
                      <img src={iconSrc} alt="" className="h-3.5 w-3.5 rounded object-cover" />
                    ) : (
                      <PresetIcon className="h-3.5 w-3.5 text-sky-400" />
                    )}
                    <span>{link.label}</span>
                  </a>
                );
              })}
            </div>
          )}

          {/* Action Buttons */}
          {showActions && (
            <div className={styles.actionsContainer}>
              <button
                type="button"
                onClick={(e) => {
                  if (onContactClick) {
                    onContactClick();
                    return;
                  }
                  const contact = {
                    name: name || 'RTBI Member',
                    phone: phone || undefined,
                    email: email || undefined,
                    company: 'RTBI Portal',
                    title: title || undefined,
                    notes: [linkedin, ...(customLinks || []).map((l) => `${l.label}: ${l.url}`)].filter(Boolean).join('\n') || undefined,
                  };
                  if (!slug || slug === 'preview') {
                    e.preventDefault();
                    const vcardLines = [
                      'BEGIN:VCARD',
                      'VERSION:3.0',
                      `FN:${name || 'RTBI Member'}`,
                      title ? `TITLE:${title}` : '',
                      phone ? `TEL;TYPE=CELL:${phone}` : '',
                      email ? `EMAIL:${email}` : '',
                      linkedin ? `URL;TYPE=LinkedIn:${linkedin}` : '',
                      ...(customLinks || []).map(link => `URL;TYPE=${link.label}:${link.url}`),
                      'ORG:RTBI Portal',
                      'END:VCARD',
                    ].filter(Boolean).join('\r\n') + '\r\n';
                    const blob = new Blob([vcardLines], { type: 'text/vcard;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const download = () => {
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `${(name || 'contact').toLowerCase().replace(/\s+/g, '-')}.vcf`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      setTimeout(() => URL.revokeObjectURL(url), 10_000);
                    };
                    saveContactToPhone({ contact, inlineUrl: url, downloadFallback: download });
                  } else {
                    saveContactToPhone({
                      contact,
                      inlineUrl: `/api/card/${slug}/vcf?inline=1`,
                      downloadFallback: () => { window.location.href = `/api/card/${slug}/vcf`; },
                    });
                  }
                }}
                className={styles.primaryActionButton}
              >
                <Download className="h-4 w-4" />
                {contactText}
              </button>

            {/* Apple & Google Wallet Buttons */}
            <div className={styles.walletGrid}>
              <button
                type="button"
                onClick={appleWalletAvailable ? onAppleWalletClick : undefined}
                disabled={!appleWalletAvailable || isOpeningAppleWallet}
                className={`${styles.appleWalletBtn} ${!appleWalletAvailable ? styles.disabledBtn : ''}`}
              >
                {isOpeningAppleWallet ? (
                  <span className="h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Wallet className="h-3.5 w-3.5" />
                )}
                {appleWalletAvailable
                  ? isOpeningAppleWallet
                    ? 'Opening Apple Pass…'
                    : 'Add to Apple Wallet'
                  : 'Apple Wallet — coming soon'}
              </button>

              <button
                type="button"
                onClick={googleWalletAvailable ? onGoogleWalletClick : undefined}
                disabled={!googleWalletAvailable || isOpeningGoogleWallet}
                className={`${styles.googleWalletBtn} ${!googleWalletAvailable ? styles.disabledBtn : ''}`}
              >
                {isOpeningGoogleWallet ? (
                  <span className="h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Wallet className="h-3.5 w-3.5" />
                )}
                {googleWalletAvailable
                  ? isOpeningGoogleWallet
                    ? 'Opening Google Pass…'
                    : 'Add to Google Wallet'
                  : 'Google Wallet — coming soon'}
              </button>
            </div>

            {walletError && (
              <p className="flex items-center justify-center gap-1.5 text-[10px] text-rose-400 pt-1">
                <AlertCircle className="h-3 w-3 shrink-0" />
                {walletError}
              </p>
            )}

            {onShowQr && (
              <button
                type="button"
                onClick={onShowQr}
                className="mt-1 w-full py-1.5 text-xs font-semibold text-slate-400 hover:text-white flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <QrCode className="h-3.5 w-3.5" />
                Display QR Code
              </button>
            )}
          </div>
        )}

          {/* iOS Safari Gyroscope Permission Prompt or Active Status */}
          {needsIosPermission && !gyroActive ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                enableIosGyroscope();
              }}
              className="mt-3 px-3 py-1.5 rounded-full bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/40 text-sky-300 text-[11px] font-bold flex items-center gap-1.5 cursor-pointer shadow-sm transition-all"
            >
              <Smartphone className="h-3.5 w-3.5 animate-bounce" />
              Tap to Enable 3D Motion (iOS)
            </button>
          ) : (
            <div className={styles.gyroscopeHint}>
              <Smartphone className="h-3 w-3 text-sky-400 animate-pulse" />
              <span>{gyroActive ? '3D Gyroscope Active — Tilt or Swipe Card' : 'Interactive 3D Motion'}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ProfileCard;
