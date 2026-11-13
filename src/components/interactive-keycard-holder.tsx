'use client';

import React, { useState, useEffect, useRef } from 'react';
import { drawStyledQr } from '@/lib/qr-style';
import type { PassQrShape } from '@/lib/local-data';
import styles from './interactive-keycard.module.css';
import type { PassTheme } from '@/lib/local-data';
import { passThemeStyle } from '@/lib/pass-theme-style';

const CARD_EXTRACT_DURATION = 850;
const CARD_TUCK_DURATION = 800;
const COVER_OPEN_DURATION = 900;
const COVER_CLOSE_DURATION = 850;

export interface InteractiveKeycardProps {
  memberName: string;
  memberRole?: string;
  memberIdNumber?: string;
  joinDate?: string;
  tier?: number | string;
  phone?: string;
  email?: string;
  photoUrl?: string;
  serialNumber?: string;
  accessLevel?: string;
  validityPeriod?: string;
  issuingAuthority?: string;
  cardUrl?: string;
  qrUrl?: string;
  /** Event pass design: text size multiplier and QR colours. */
  fontScale?: number;
  qrDark?: string;
  qrLight?: string;
  qrEye?: string;
  qrShape?: PassQrShape;
  qrLogo?: boolean;
  /** Custom logo (event theme logo). Used on the card faces, the QR centre and the holder's debossed cover so they all match. */
  logoUrl?: string;
  onSaveContact?: () => void;
  saveContactLabel?: string;
  onAddToAppleWallet?: () => void;
  onAddToGoogleWallet?: () => void;
  isGeneratingWallet?: boolean;
  walletError?: string;
  showActions?: boolean;
  autoOpen?: boolean;
  /** After opening, pull the card forward automatically (used by design previews so the card face is visible). */
  autoExtract?: boolean;

  // Event Pass Specific Props
  isEventPass?: boolean;
  eventName?: string;
  /** Event pass: don't print the event title on the card front. */
  hideEventTitle?: boolean;
  eventDate?: string;
  passType?: string;
  guestCategory?: string;
  roomOrVenue?: string;
  attendeeOrg?: string;
  brandHeader?: string;
  passColor?: string;
  passGradient?: string;
  theme?: PassTheme;
}

export function InteractiveKeycardHolder({
  memberName = 'Executive Member',
  memberRole = 'LEADS Member',
  memberIdNumber,
  joinDate,
  tier,
  phone = '+91 9608768647',
  email = 'member@leads-centre.org',
  photoUrl,
  serialNumber,
  accessLevel = 'Executive & Alumni Fellow (Tier 1)',
  validityPeriod,
  issuingAuthority = 'RTBI Portal',
  cardUrl,
  qrUrl = '/card/leads-qr-code.png',
  fontScale = 1,
  qrDark = '#0B1B2E',
  qrLight = '#ffffff',
  qrEye = '',
  qrShape = 'square',
  qrLogo = true,
  logoUrl,
  onSaveContact,
  saveContactLabel = 'Save Contact',
  onAddToAppleWallet,
  onAddToGoogleWallet,
  isGeneratingWallet = false,
  walletError,
  showActions = true,
  autoOpen = false,
  autoExtract = false,

  // Event Pass Specific Props
  isEventPass,
  eventName,
  hideEventTitle,
  eventDate,
  passType,
  guestCategory,
  roomOrVenue,
  attendeeOrg,
  brandHeader,
  passColor,
  passGradient,
  theme,
}: InteractiveKeycardProps) {
  const [stageState, setStageState] = useState<'init' | 'entered' | 'opened' | 'extracting' | 'extracted' | 'tucking' | 'closing'>('init');
  const [activeTab, setActiveTab] = useState<'card' | 'creds' | 'bookfold'>('card');
  const [isFlipped, setIsFlipped] = useState(false);
  const [dynamicQrUrl, setDynamicQrUrl] = useState<string>('');
  const cardRef = useRef<HTMLDivElement>(null);
  const dragInfo = useRef({ isDragging: false, startY: 0, currentDeltaY: 0, hasDragged: false });
  const holderDragInfo = useRef({ isDragging: false, startY: 0, hasDragged: false });

  const cardLogo = logoUrl || '/card/leads-logo.png';
  const markLogo = logoUrl || '/card/leads-logo-clean.png';

  const isEvent = Boolean(isEventPass || eventName || passType);

  const memberInitials = (memberName || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('');

  // Compute 1-year dynamic validity if not passed
  const formattedValidity = React.useMemo(() => {
    if (validityPeriod) return validityPeriod;
    const now = new Date();
    const nextYear = new Date(now);
    nextYear.setFullYear(now.getFullYear() + 1);
    const formatDate = (d: Date) =>
      d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${formatDate(now)} – ${formatDate(nextYear)} (1 Year)`;
  }, [validityPeriod]);


  // Compute unique serial ID if not passed
  const formattedSerial = React.useMemo(() => {
    if (serialNumber) return serialNumber;
    const hash = Math.abs(
      (memberName + email).split('').reduce((acc, char) => (acc << 5) - acc + char.charCodeAt(0), 0)
    )
      .toString(36)
      .toUpperCase()
      .padStart(5, '0')
      .slice(0, 5);
    return `LEADS-DIR-${hash}`;
  }, [serialNumber, memberName, email]);

  // Compute unique Member ID Number (Sequence: Joining Date + Tier Level + Unique Serial Hash)
  const formattedMemberId = React.useMemo(() => {
    if (memberIdNumber) return memberIdNumber;

    let datePart = '2026';
    if (joinDate) {
      try {
        const d = new Date(joinDate);
        if (!isNaN(d.getTime())) {
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          datePart = `${y}${m}`;
        }
      } catch (e) {}
    } else {
      const now = new Date();
      datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    const tierCode = tier !== undefined && tier !== null
      ? `T${tier}`
      : accessLevel?.includes('Tier 1') || memberRole?.toLowerCase().includes('president') || memberRole?.toLowerCase().includes('coordinator')
      ? 'T1'
      : 'T2';

    const seed = `${memberName}-${email}-${serialNumber || ''}`;
    const hashNum = Math.abs(
      seed.split('').reduce((acc, char) => (acc << 5) - acc + char.charCodeAt(0), 0)
    );
    const seqNum = String((hashNum % 9000) + 1000); // 4-digit unique sequence number

    return `LEADS-${datePart}-${tierCode}-${seqNum}`;
  }, [memberIdNumber, joinDate, tier, memberName, email, serialNumber, accessLevel, memberRole]);

  // Dynamically generate QR code with LEADS logo in center
  useEffect(() => {
    let isMounted = true;

    const generateQr = async () => {
      let targetUrl = cardUrl || qrUrl;
      // If no valid URL string was provided or only default PNG path, compute public URL fallback
      if (!targetUrl || targetUrl.endsWith('.png') || targetUrl.endsWith('.jpg')) {
        if (cardUrl) {
          targetUrl = cardUrl;
        } else if (typeof window !== 'undefined') {
          targetUrl = window.location.href;
        } else {
          targetUrl = 'https://leads-centre.org';
        }
      }

      try {
        const qrCanvas = document.createElement('canvas');
        qrCanvas.width = qrCanvas.height = 360;
        const ctx = qrCanvas.getContext('2d');
        if (!ctx) return;
        const draw = (logo?: HTMLImageElement) => {
          drawStyledQr(ctx, targetUrl, 0, 0, 360, { dark: qrDark, light: qrLight, eye: qrEye || undefined, shape: qrShape, logo });
          if (isMounted) setDynamicQrUrl(qrCanvas.toDataURL('image/png'));
        };
        if (!qrLogo) return draw();
        const logo = new Image();
        logo.onload = () => draw(logo);
        logo.onerror = () => draw();
        logo.src = markLogo;
      } catch (err) {
        console.warn('[InteractiveKeycard] QR generation warning:', err);
      }
    };

    generateQr();
    return () => { isMounted = false; };
  }, [cardUrl, qrUrl, qrDark, qrLight, qrEye, qrShape, qrLogo, markLogo]);

  useEffect(() => {
    // Respect reduced-motion preferences: skip the cover/extract choreography entirely
    const reduceMotion =
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const timer = setTimeout(() => {
      setStageState(autoOpen || reduceMotion ? 'opened' : 'entered');
    }, 350);
    return () => clearTimeout(timer);
  }, [autoOpen]);

  useEffect(() => {
    if (!autoExtract || stageState !== 'opened') return;
    const t = setTimeout(() => {
      setIsFlipped(false);
      setStageState('extracting');
      setTimeout(() => setStageState('extracted'), CARD_EXTRACT_DURATION);
    }, 450);
    return () => clearTimeout(t);
  }, [autoExtract, stageState]);

  const handleHolderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest(`.${styles.passCard}`) || (e.target as HTMLElement).closest(`.${styles.coverBack}`)) {
      return;
    }
    if (stageState === 'extracting' || stageState === 'tucking' || stageState === 'closing') return;
    holderDragInfo.current = { isDragging: true, startY: e.clientY, hasDragged: false };
  };

  const handleHolderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!holderDragInfo.current.isDragging) return;
    const deltaY = holderDragInfo.current.startY - e.clientY;
    if (Math.abs(deltaY) > 8) {
      holderDragInfo.current.hasDragged = true;
    }
  };

  const handleHolderPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!holderDragInfo.current.isDragging) return;
    holderDragInfo.current.isDragging = false;
    if (stageState === 'extracting' || stageState === 'tucking' || stageState === 'closing') return;

    const deltaY = holderDragInfo.current.startY - e.clientY;
    const wasSwipe = holderDragInfo.current.hasDragged;

    if (stageState === 'entered') {
      if (!wasSwipe || deltaY > 40) {
        setStageState('opened');
        setActiveTab('card');
      }
    } else if (stageState === 'opened') {
      if (!wasSwipe || deltaY < -40) {
        setStageState('closing');
        setTimeout(() => {
          setStageState('entered');
        }, COVER_CLOSE_DURATION);
      }
    } else if (stageState === 'extracted') {
      if (!wasSwipe || deltaY < -40) {
        triggerExtract();
      }
    }
  };

  const triggerExtract = () => {
    if (stageState === 'opened') {
      setIsFlipped(false);
      setStageState('extracting');
      setTimeout(() => {
        setStageState('extracted');
      }, CARD_EXTRACT_DURATION);
    } else if (stageState === 'extracted') {
      setIsFlipped(false);
      setStageState('tucking');
      setTimeout(() => {
        setStageState('opened');
      }, CARD_TUCK_DURATION);
    }
  };

  const toggleFlip = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (stageState === 'extracted') {
      setIsFlipped((prev) => !prev);
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (stageState !== 'opened' && stageState !== 'extracted') return;

    dragInfo.current = {
      isDragging: true,
      startY: e.clientY,
      currentDeltaY: 0,
      hasDragged: false,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragInfo.current.isDragging) return;
    const deltaY = dragInfo.current.startY - e.clientY;

    if (Math.abs(deltaY) > 8) {
      dragInfo.current.hasDragged = true;
    }

    if (stageState === 'opened' && cardRef.current) {
      if (deltaY > 0) {
        dragInfo.current.currentDeltaY = Math.min(deltaY, 200);
        const progress = dragInfo.current.currentDeltaY / 200;
        const zOffset = 2 + progress * 88;
        const yOffset = -26 * (1 - progress);
        cardRef.current.style.transition = 'none';
        cardRef.current.style.transform = `translateZ(${zOffset}px) translateY(${yOffset}px) scale(${1 + progress * 0.03})`;
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragInfo.current.isDragging) return;
    dragInfo.current.isDragging = false;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch (_) {}

    if (cardRef.current) {
      cardRef.current.style.transition = '';
      cardRef.current.style.transform = '';
    }

    if (dragInfo.current.hasDragged) {
      if (stageState === 'opened') {
        if (dragInfo.current.currentDeltaY > 40) {
          triggerExtract();
        }
      } else if (stageState === 'extracted') {
        if (dragInfo.current.currentDeltaY < -40) {
          triggerExtract();
        }
      }
    } else {
      if (stageState === 'opened') {
        triggerExtract();
      } else if (stageState === 'extracted') {
        toggleFlip();
      }
    }
    dragInfo.current.currentDeltaY = 0;
  };

  const handleReplay = () => {
    setStageState('init');
    setActiveTab('card');
    setIsFlipped(false);
    setTimeout(() => {
      setStageState('entered');
    }, 400);
  };

  const getHolderClasses = () => {
    const classes = [styles.holderWrap];
    if (stageState !== 'init') classes.push(styles.entered);
    if (stageState === 'opened' || stageState === 'extracting' || stageState === 'extracted' || stageState === 'tucking') {
      classes.push(styles.opened);
    }
    if (stageState === 'extracting') {
      classes.push(styles.cardExtracting, styles.cardExtracted);
    } else if (stageState === 'extracted') {
      classes.push(styles.cardExtracted);
    } else if (stageState === 'tucking') {
      classes.push(styles.cardTucking);
    }
    if (stageState === 'closing') {
      classes.push(styles.closing);
    }
    if (activeTab === 'creds') {
      classes.push(styles.showCreds);
    } else if (activeTab === 'bookfold') {
      classes.push(styles.showBookfold);
    }
    return classes.join(' ');
  };

  const getPassCardClasses = () => {
    const classes = [styles.passCard];
    if (isFlipped) classes.push(styles.isFlipped);
    return classes.join(' ');
  };

  return (
    <div className={styles.stageContainer}>
      {/* SVG Mask Definition for Clean Blind Debossed Leather Mark */}
      <svg width="0" height="0" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }} aria-hidden="true">
        <defs>
          <mask id="leads-deboss-mask" maskUnits="objectBoundingBox" maskContentUnits="objectBoundingBox">
            <image href={markLogo} width="1" height="1" preserveAspectRatio="xMidYMid meet" />
          </mask>
        </defs>
      </svg>

      {/* Top Status Bar & Controls */}
      <div className={styles.headerPanel}>
        <div className={styles.statusBadge}>
          <span className={styles.statusDot} />
          <span>
            {stageState === 'init' && (isEvent ? 'Preparing your pass...' : 'Minting Credentials...')}
            {stageState === 'entered' && (isEvent ? 'Tap the folder to open your pass' : 'Tap leather holder to open')}
            {stageState === 'opened' &&
              (activeTab === 'card'
                ? 'Tap card to pull forward'
                : activeTab === 'creds'
                ? isEvent
                  ? 'Viewing Pass Details Sleeve'
                  : 'Viewing Member Credentials Sleeve'
                : 'Viewing Complete 3D Bookfold')}
            {stageState === 'extracting' && 'Extracting card...'}
            {stageState === 'extracted' &&
              (isFlipped ? 'Viewing Back Details (5 Fields) · Tap to Flip ↻' : 'Card Ready · Tap card to flip ↻')}
            {stageState === 'tucking' && 'Tucking card back...'}
            {stageState === 'closing' && 'Closing leather holder...'}
          </span>
        </div>

        {(stageState === 'opened' || stageState === 'extracted' || stageState === 'extracting') && (
          <div className={styles.mobileFlapToggle}>
            <button
              type="button"
              className={`${styles.flapTab} ${activeTab === 'card' ? styles.flapTabActive : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                setActiveTab('card');
              }}
            >
              💳 Keycard
            </button>
            <button
              type="button"
              className={`${styles.flapTab} ${activeTab === 'creds' ? styles.flapTabActive : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                setActiveTab('creds');
              }}
            >
              📋 Credentials
            </button>
            <button
              type="button"
              className={`${styles.flapTab} ${activeTab === 'bookfold' ? styles.flapTabActive : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                setActiveTab('bookfold');
              }}
            >
              📖 Bookfold
            </button>
          </div>
        )}
      </div>

      {/* 3D Experience Stage */}
      <div className={styles.experienceStage}>
        <div
          className={getHolderClasses()}
          onPointerDown={handleHolderPointerDown}
          onPointerMove={handleHolderPointerMove}
          onPointerUp={handleHolderPointerUp}
          onPointerCancel={handleHolderPointerUp}
          style={{
            '--card-extract-duration': `${CARD_EXTRACT_DURATION}ms`,
            '--card-tuck-duration': `${CARD_TUCK_DURATION}ms`,
            '--cover-open-duration': `${COVER_OPEN_DURATION}ms`,
            '--cover-close-duration': `${COVER_CLOSE_DURATION}ms`,
            ...(logoUrl ? { '--holder-logo': `url("${logoUrl}")` } : {}),
          } as React.CSSProperties}
        >
          {/* Base Body & Inside Right Pocket */}
          <div className={`${styles.holderBase} ${styles.leatherTexture}`}>
            <div className={styles.baseStitch} />

            {/* Pass Card with 3D Flip Engine */}
            <div
              ref={cardRef}
              className={getPassCardClasses()}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              title="Click or drag to pull / flip card"
            >
              <div className={styles.passInner}>
                {/* FRONT FACE */}
                {isEvent ? (
                  /* EVENT PASS LUXURY TURNSTILE CREDENTIAL (MATCHES STUDIO DESIGN) */
                  <div
                    className={`${styles.passFace} ${styles.eventPassFront}`}
                    style={{
                      ...(passThemeStyle(
                        theme,
                        passGradient || (passColor ? `linear-gradient(145deg, ${passColor} 0%, #030712 100%)` : undefined)
                      ) || {}),
                      ['--pass-font-scale' as string]: String(fontScale || 1),
                    } as React.CSSProperties}
                  >
                    {/* Luxury Holographic Foil Shimmer */}
                    <div className={styles.holographicFoil} />

                    <div className={styles.eventPassBody}>
                      <div className={styles.eventPassHeader}>
                        <div className={styles.eventBrandWrap}>
                          <img src={cardLogo} alt="LEADS Logo" className={styles.eventBrandLogo} />
                          <div className={styles.eventBrandText}>
                            <span className={styles.eventBrandTitle}>{brandHeader || 'RTBI Portal'}</span>
                            <span className={styles.eventBrandSubtitle}>RUAS Executive Credential</span>
                          </div>
                        </div>
                        <span className={styles.eventPassTypeBadge}>
                          {passType || 'VIP PASS'}
                        </span>
                      </div>

                      {/* Event Info Section */}
                      <div className={styles.eventInfoSection}>
                        {!hideEventTitle && (
                          <div className={styles.eventTitleHeader}>
                            {eventName || 'Official LEADS Event'}
                          </div>
                        )}
                        <div className={styles.eventDateBadge}>
                          <span>🗓️</span>
                          <span>{validityPeriod || eventDate || '2026'}</span>
                        </div>
                      </div>

                      {/* Guest Identity Card */}
                      <div className={styles.guestIdentityCard}>
                        <div className={styles.guestTagPill}>
                          <span>🏷️</span>
                          <span>{guestCategory || 'Guest Attendee'}</span>
                        </div>
                        <div className={styles.guestAttendeeName}>
                          {memberName}
                        </div>

                        <div className={styles.guestMetaGrid}>
                          <div className={styles.guestMetaItem}>
                            <span className={styles.guestMetaLabel}>Assigned Room / Venue</span>
                            <span className={styles.guestMetaVal}>📍 {roomOrVenue || 'Main Auditorium'}</span>
                          </div>
                          <div className={styles.guestMetaItem}>
                            <span className={styles.guestMetaLabel}>Affiliation / Tier</span>
                            <span className={styles.guestMetaVal}>{attendeeOrg || memberRole || 'Guest Invitee'}</span>
                          </div>
                        </div>
                      </div>

                      {/* Turnstile QR Code Module */}
                      <div className={styles.turnstileQrContainer}>
                        <img
                          src={dynamicQrUrl || qrUrl || '/card/leads-qr-code.png'}
                          alt="Turnstile QR"
                          className={styles.turnstileQrImage}
                        />
                        <div className={styles.turnstileMetaLeft}>
                          <span className={styles.turnstileSerialText}>
                            {serialNumber || formattedSerial}
                          </span>
                          <span className={styles.turnstileSignedBadge}>
                            <span>🛡️</span> Scan QR at entry
                          </span>
                          <span className={styles.turnstileHintSub}>
                            Valid at all official event turnstiles
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className={styles.passCardFooter}>
                      <div className={styles.flipAffordanceHint}>
                        <span>↻</span>
                        <span>Tap to Flip for Pass Terms & Security Protocol</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '8px', color: '#94a3b8' }}>
                        <span>💳 {issuingAuthority || 'RTBI Portal • RUAS'}</span>
                        <span>SECURE CREDENTIAL</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* MEMBER VISITING CARD */
                  <div className={`${styles.passFace} ${styles.passFront}`}>
                    {/* Luxury Holographic Foil Shimmer */}
                    <div className={styles.holographicFoil} />

                    <div>
                      <div className={styles.passHeader}>
                        <img src={cardLogo} alt="LEADS Logo" className={styles.passMiniLogo} />
                        <span className={styles.passBadgePill}>EXECUTIVE PASS</span>
                      </div>

                      {/* Member Photo & Executive Identity */}
                      <div className={styles.passAvatarArea}>
                        <div className={styles.passPhotoWrap}>
                          {photoUrl ? (
                            <img src={photoUrl} alt={memberName} className={styles.passPhotoImage} />
                          ) : (
                            <div className={styles.passPhotoInitials}>{memberInitials}</div>
                          )}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className={styles.passLabel}>{memberRole}</div>
                          <div className={styles.passName} style={{ fontSize: '15px' }}>{memberName}</div>
                        </div>
                        <img src={markLogo} alt="LEADS RUAS" className={styles.passSideLogo} />
                      </div>

                      <div className={styles.passGrid}>
                        <div>
                          <div className={styles.passLabel}>Phone Number</div>
                          <div className={styles.passVal}>{phone || '—'}</div>
                        </div>
                        <div>
                          <div className={styles.passLabel}>Email ID</div>
                          <div className={styles.passVal} title={email}>{email}</div>
                        </div>
                      </div>

                      <div className={styles.passQrBox}>
                        <img src={dynamicQrUrl || qrUrl || '/card/leads-qr-code.png'} alt="Card QR Code" />
                      </div>
                    </div>

                    <div className={styles.passCardFooter}>
                      <div className={styles.flipAffordanceHint}>
                        <span>↻</span>
                        <span>Tap to Flip for 5 Verification Fields</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '8.5px' }}>
                        <span>💳</span>
                        <span>{issuingAuthority}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* BACK FACE */}
                <div className={`${styles.passFace} ${styles.passBack}`}>
                  <div className={styles.passBackHeader}>
                    <div>
                      <div className={styles.passLabel}>{isEvent ? 'PASS TERMS & PROTOCOL' : 'EXECUTIVE CREDENTIALS'}</div>
                      <div className={styles.passBackTitle}>{isEvent ? 'RUAS Secure Event Pass' : 'LEADS Pass Info'}</div>
                    </div>
                    <button className={styles.btnFlipPill} onClick={toggleFlip} title="Flip to front">
                      <span>↺</span>
                      <span>Front</span>
                    </button>
                  </div>

                  {isEvent && <div className={styles.magneticStripeGraphic} />}

                  <div className={styles.passBackFields}>
                    <div className={styles.backFieldRow}>
                      <span className={styles.backFieldLabel}>1. Access Level & Tier</span>
                      <span className={styles.backFieldVal}>{passType || accessLevel}</span>
                    </div>
                    <div className={styles.backFieldRow}>
                      <span className={styles.backFieldLabel}>2. {isEvent ? 'Pass ID / Serial' : 'Member ID / Serial'}</span>
                      <span className={styles.backFieldVal} style={{ fontFamily: 'monospace', color: '#0284c7' }}>
                        {isEvent ? (serialNumber || formattedSerial) : (formattedMemberId || formattedSerial)}
                      </span>
                    </div>
                    <div className={styles.backFieldRow}>
                      <span className={styles.backFieldLabel}>3. {isEvent ? 'Event & Validity' : 'Validity Period'}</span>
                      <span className={styles.backFieldVal}>
                        {isEvent ? `${eventName || 'Official Event'} (${validityPeriod || '2026'})` : formattedValidity}
                      </span>
                    </div>
                    <div className={styles.backFieldRow}>
                      <span className={styles.backFieldLabel}>4. {isEvent ? 'Designated Venue / Hall' : 'Issuing Authority'}</span>
                      <span className={styles.backFieldVal}>
                        {isEvent ? `📍 ${roomOrVenue || 'Main Auditorium'}` : issuingAuthority}
                      </span>
                    </div>
                    <div className={styles.backFieldRow}>
                      <span className={styles.backFieldLabel}>5. Terms & Entry Verification</span>
                      <p className={styles.backNoticeText}>
                        {isEvent
                          ? 'Scan front QR code at entry turnstiles. Pass is strictly non-transferable.'
                          : 'Scan front QR code at entry turnstiles. Non-transferable pass.'}
                      </p>
                    </div>
                  </div>

                  <div className={styles.passBackFooter}>
                    <span>© 2026 {issuingAuthority}</span>
                    <span>Tap card to flip</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Curved Die-Cut Leather Pocket Sleeve */}
            <div className={styles.curvedPocketSleeve}>
              <div className={styles.curvedPocketStitch} />
              <div className={styles.pocketFooterContent}>
                <div className={styles.pocketBrandLabel}>
                  <svg className={styles.pocketIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                  </svg>
                  <span>Pass Holder</span>
                </div>
                {stageState !== 'extracted' && stageState !== 'extracting' && (
                  <span className={styles.tapHintPill}>Tap Card &uarr;</span>
                )}
              </div>
            </div>
          </div>

          {/* 3D Flipping Leather Front Cover Leaf */}
          <div className={styles.coverLeaf}>
            {/* Front Side: True Physical Blind Debossed Leather Logo */}
            <div className={styles.coverFront}>
              <div className={styles.coverStitch} />
              <div className={styles.debossedLeatherMark} aria-label="RTBI Portal">
                <div className={styles.debossCavity} />
                <div className={styles.debossShadowBevel} />
                <div className={styles.debossHighlightBevel} />
              </div>
              <div className={styles.coverPrompt}>Tap to Open &rarr;</div>
            </div>

            {/* Back Side: Interior Left Flap */}
            <div
              className={styles.coverBack}
              onClick={() => {
                if (stageState === 'opened') setActiveTab('creds');
              }}
            >
              <div className={styles.coverBackStitch} />
              <div className={styles.leftPanelHeader}>
                <div>
                  <div className={styles.leftPanelTitle}>LEADS Centre</div>
                  <div className={styles.leftPanelSub}>{isEvent ? 'Official Event Pass' : 'Executive Pass'}</div>
                </div>
                <span className={styles.leftBadgeTag}>{isEvent ? 'Verified' : 'Official'}</span>
              </div>

              <div className={styles.leftFormFields}>
                <div className={styles.formSlot}>
                  <span className={styles.formSlotLabel}>{isEvent ? 'Attendee Name' : 'Member Name'}</span>
                  <div className={styles.formSlotPill}>{memberName}</div>
                </div>
                <div className={styles.formSlot}>
                  <span className={styles.formSlotLabel}>{isEvent ? 'Guest Category / Tier' : 'Designation / Role'}</span>
                  <div className={styles.formSlotPill}>
                    {isEvent
                      ? (guestCategory ? `${guestCategory} (${passType || 'Pass'})` : (passType || memberRole))
                      : memberRole}
                  </div>
                </div>
                <div className={styles.formSlot}>
                  <span className={styles.formSlotLabel}>{isEvent ? 'Pass ID' : 'Official Member ID'}</span>
                  <div className={styles.formSlotPill} style={{ fontFamily: 'monospace', fontWeight: 800, color: '#38bdf8' }}>
                    {isEvent ? (serialNumber || formattedSerial) : formattedMemberId}
                  </div>
                </div>
                {isEvent ? (
                  <>
                    <div className={styles.formSlot}>
                      <span className={styles.formSlotLabel}>Event / Occasion</span>
                      <div className={styles.formSlotPill}>{eventName || 'LEADS Official Event'}</div>
                    </div>
                    <div className={styles.formSlot}>
                      <span className={styles.formSlotLabel}>Assigned Room / Venue</span>
                      <div className={styles.formSlotPill}>📍 {roomOrVenue || 'Main Auditorium'}</div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className={styles.formSlot}>
                      <span className={styles.formSlotLabel}>Phone</span>
                      <div className={styles.formSlotPill}>{phone || '—'}</div>
                    </div>
                  </>
                )}
                <div className={styles.formSlot}>
                  <span className={styles.formSlotLabel}>Email</span>
                  <div className={styles.formSlotPill}>{email}</div>
                </div>
              </div>

              <div className={styles.leftPanelFooter}>
                M. S. Ramaiah University of Applied Sciences<br />
                New BEL Road, MSR Nagar, Bengaluru - 560054
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons Panel */}
      {showActions && (
        <div className={styles.actionsPanel}>
          <button className={styles.btnAction} onClick={handleReplay}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            Replay
          </button>

          {(stageState === 'init' || stageState === 'entered') && (
            <button className={styles.btnAction} onClick={() => setStageState('opened')}>
              Skip animation
            </button>
          )}

          {onSaveContact && (
            <button className={styles.btnAction} onClick={onSaveContact}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {saveContactLabel}
            </button>
          )}

          {onAddToAppleWallet && (
            <button
              className={`${styles.btnAction} ${styles.btnWallet}`}
              onClick={onAddToAppleWallet}
              disabled={isGeneratingWallet}
            >
              {isGeneratingWallet ? 'Generating Pass…' : isEvent ? 'Add to Wallet' : 'Apple / Google Wallet'}
            </button>
          )}
        </div>
      )}

      {walletError && (
        <p style={{ color: '#f87171', fontSize: '11px', marginTop: '6px' }}>{walletError}</p>
      )}
    </div>
  );
}

/** Static, closed leather cover (no animation or controls): shows the debossed logo exactly as the folder draws it. */
export function HolderCoverPreview({ logoUrl, width = 220 }: { logoUrl?: string; width?: number }) {
  const mark = Math.round(width * 0.72);
  return (
    <div
      style={{
        position: 'relative',
        width,
        height: Math.round(width * 1.45),
        ...(logoUrl ? { '--holder-logo': `url("${logoUrl}")` } : {}),
      } as React.CSSProperties}
      aria-label="Leather folder cover"
    >
      <div className={styles.coverFront} style={{ padding: 0 }}>
        <div className={styles.coverStitch} />
        <div className={styles.debossedLeatherMark} style={{ width: mark, height: mark, cursor: 'default' }}>
          <div className={styles.debossCavity} />
          <div className={styles.debossShadowBevel} />
          <div className={styles.debossHighlightBevel} />
        </div>
      </div>
    </div>
  );
}

export default InteractiveKeycardHolder;
