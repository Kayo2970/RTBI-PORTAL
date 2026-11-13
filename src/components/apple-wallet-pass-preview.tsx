'use client';

import React, { useState } from 'react';
import { Info, RotateCw } from 'lucide-react';
import styles from './apple-wallet-pass.module.css';
import { AppleWalletPosterPreview } from './apple-wallet-poster-preview';
import type { PassBarcodeFormat, PassQrOptions, PassTheme } from '@/lib/local-data';
import { passThemeStyle } from '@/lib/pass-theme-style';

export interface AppleWalletPassPreviewProps {
  attendeeName: string;
  guestCategory?: string;
  passType: string;
  roomOrVenue?: string;
  eventName: string;
  eventDate?: string;
  validityDate?: string;
  serialNumber: string;
  qrPayload?: string;
  issuedBy?: string;
  interactive?: boolean;
  logoText?: string;
  logoUrl?: string;
  passColor?: string;
  theme?: PassTheme;
  /** 'poster' = iOS 27 layout used when the event has background artwork; 'classic' = older iOS. */
  layout?: 'poster' | 'classic';
  validDaysCount?: number;
  validDays?: string[];
  passGradient?: string;
  textColor?: string;
  labelColor?: string;
  fontScale?: number;
  showEventTitle?: boolean;
  barcodeFormat?: PassBarcodeFormat;
  altText?: 'serial' | 'name' | 'none';
  qr?: PassQrOptions;
}

export function AppleWalletPassPreview({
  attendeeName,
  guestCategory = 'Guest Attendee',
  passType = 'VIP Pass',
  roomOrVenue = 'Main Auditorium',
  eventName = 'RTBI Official Event',
  eventDate = '2026',
  validityDate,
  serialNumber,
  interactive = true,
  logoText = 'RTBI',
  logoUrl = '/card/rtbi-logo.png',
  passColor = '#0f1a2e',
  theme,
  layout = 'poster',
  validDaysCount = 0,
  validDays,
  passGradient,
  textColor,
  labelColor,
  fontScale,
  showEventTitle,
  barcodeFormat,
  altText,
  qr,
}: AppleWalletPassPreviewProps) {
  const [isFlipped, setIsFlipped] = useState(false);

  const displayValidity = validityDate || eventDate;
  const displaySerial = serialNumber || `RTBI-EVT-2026-${(attendeeName || 'GUEST').slice(0, 3).toUpperCase()}-99`;

  const baseBackground = passColor ? `linear-gradient(180deg, ${passColor} 0%, #060c18 100%)` : undefined;
  const frontStyle: React.CSSProperties = passThemeStyle(theme, baseBackground) || {};
  const backStyle: React.CSSProperties = passThemeStyle(theme, baseBackground) || {};

  if (layout === 'poster') {
    return (
      <div className={styles.walletContainer} style={{ height: 'auto' }}>
        <AppleWalletPosterPreview
          attendeeName={attendeeName}
          guestCategory={guestCategory}
          passType={passType}
          roomOrVenue={roomOrVenue}
          eventName={eventName}
          validity={displayValidity || ''}
          serialNumber={displaySerial}
          validDaysCount={validDaysCount}
          validDays={validDays}
          logoUrl={theme?.logoUrl || logoUrl}
          theme={theme}
          passColor={passColor}
          passGradient={passGradient}
          textColor={textColor}
          labelColor={labelColor}
          fontScale={fontScale}
          showEventTitle={showEventTitle}
          barcodeFormat={barcodeFormat}
          altText={altText}
          qr={qr}
        />
        <p className="text-[10px] text-slate-500 text-center max-w-[300px] mx-auto mt-2">
          iOS 27 poster layout. Apple draws the logo, barcode panel and field row in white over the artwork — the base colour we send is always dark so the text stays white.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.walletContainer}>
      <div
        className={`${styles.walletCard} ${isFlipped ? styles.isFlipped : ''}`}
        onClick={interactive ? () => setIsFlipped(!isFlipped) : undefined}
      >
        {/* FRONT FACE (98% Pixel-Accurate Native iOS Wallet) */}
        <div className={`${styles.passFace} ${styles.passFront}`} style={frontStyle}>
          {/* Header */}
          <div className={styles.headerRow}>
            <div className={styles.logoArea}>
              <img
                src={logoUrl}
                alt="Logo"
                className={styles.passLogo}
              />
              <span className={styles.logoText}>{logoText}</span>
            </div>
            <div className={styles.headerField}>
              <div className={styles.headerLabel}>Access</div>
              <div className={styles.headerValue}>
                {(passType || 'VIP PASS').toUpperCase()}
              </div>
            </div>
          </div>

          {/* Primary Field */}
          <div className={styles.primarySection}>
            <div className={styles.primaryLabel}>
              {(guestCategory || 'GUEST ATTENDEE').toUpperCase()}
            </div>
            <div className={styles.primaryValue}>
              {attendeeName.trim() || 'Attendee Name'}
            </div>
          </div>

          {/* Secondary Fields */}
          <div className={styles.secondaryRow}>
            <div className={styles.fieldItem}>
              <div className={styles.fieldLabel}>Room / Venue</div>
              <div className={`${styles.fieldValue} ${styles.roomHighlight}`}>
                {roomOrVenue || 'Main Auditorium'}
              </div>
            </div>
            <div className={styles.fieldItem}>
              <div className={styles.fieldLabel}>Validity</div>
              <div className={styles.fieldValue}>{displayValidity}</div>
            </div>
          </div>

          {/* Barcode / QR Box */}
          <div className={styles.barcodeCard}>
            <div className={styles.qrContainer}>
              <img src="/card/rtbi-qr-code.png" alt="Wallet QR" />
            </div>
            <span className={styles.barcodeAltText}>{displaySerial}</span>
          </div>

          {/* Footer & Flip Trigger */}
          <div className={styles.footerRow}>
            <span className={styles.appleWalletTag}>Apple Wallet Pass</span>
            <button
              type="button"
              className={styles.infoButton}
              onClick={(e) => {
                e.stopPropagation();
                setIsFlipped(!isFlipped);
              }}
              title="Pass Details"
            >
              i
            </button>
          </div>
        </div>

        {/* BACK FACE (iOS Details Sheet) */}
        <div className={`${styles.passFace} ${styles.passBack}`} style={backStyle}>
          <div className={styles.backHeader}>
            <span className={styles.backTitle}>Pass Details</span>
            <button
              type="button"
              className={styles.doneButton}
              onClick={(e) => {
                e.stopPropagation();
                setIsFlipped(false);
              }}
            >
              Done
            </button>
          </div>

          <div className={styles.backList}>
            <div className={styles.backItem}>
              <span className={styles.backItemLabel}>Event Title</span>
              <span className={styles.backItemValue}>{eventName}</span>
            </div>
            <div className={styles.backItem}>
              <span className={styles.backItemLabel}>Pass Serial Number</span>
              <span className="font-mono text-[10px] font-bold text-sky-400">
                {displaySerial}
              </span>
            </div>
            <div className={styles.backItem}>
              <span className={styles.backItemLabel}>Assigned Room / Venue</span>
              <span className={styles.backItemValue}>{roomOrVenue}</span>
            </div>
            <div className={styles.backItem}>
              <span className={styles.backItemLabel}>Issuing Authority</span>
              <span className={styles.backItemValue}>
                RTBI • RUAS
              </span>
            </div>
            <div className={styles.backItem}>
              <span className={styles.backItemLabel}>Access Policy</span>
              <span className="text-[9.5px] text-slate-300">
                Strictly non-transferable. Present at official event turnstiles.
              </span>
            </div>
          </div>

          <div className={styles.footerRow}>
            <span className="text-[8px] text-slate-500">
              Generated via WalletWallet API
            </span>
            <button
              type="button"
              className={styles.doneButton}
              onClick={(e) => {
                e.stopPropagation();
                setIsFlipped(false);
              }}
            >
              Flip Back
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AppleWalletPassPreview;
