'use client';

import React, { useState } from 'react';
import { Bell, X, Send, Users, User, Layers, CheckCircle2, AlertCircle, Sparkles } from 'lucide-react';
import { EventPassItem } from '@/lib/local-data';
import { SearchableSelect } from '@/components/searchable-select';

const PUSH_GUEST_CATEGORIES = [
  'VIP Dignitary',
  'Keynote Speaker',
  'Faculty',
  'Student',
  'Industry Partner',
  'Alumni',
  'Organizer / Crew',
  'Press / Media',
  'Special Guest',
];

interface EventPassPushModalProps {

  isOpen: boolean;
  onClose: () => void;
  eventId: string;
  eventName: string;
  passes: EventPassItem[];
  initialSelectedPass?: EventPassItem | null;
  onBroadcastSuccess?: () => void;
}

export function EventPassPushModal({
  isOpen,
  onClose,
  eventId,
  eventName,
  passes,
  initialSelectedPass,
  onBroadcastSuccess,
}: EventPassPushModalProps) {
  const [targetType, setTargetType] = useState<'all' | 'category' | 'single'>(
    initialSelectedPass ? 'single' : 'all'
  );
  const [selectedCategory, setSelectedCategory] = useState<string>('VIP');
  const [selectedPassId, setSelectedPassId] = useState<string>(
    initialSelectedPass?.id || (passes[0]?.id ?? '')
  );
  const [message, setMessage] = useState('');
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    details?: any;
  } | null>(null);

  if (!isOpen) return null;

  const activePasses = passes.filter((p) => p.status === 'Active');
  const categoryCount = activePasses.filter(
    (p) => (p.guestCategory || '').toLowerCase() === selectedCategory.toLowerCase()
  ).length;

  const targetCount =
    targetType === 'all'
      ? activePasses.length
      : targetType === 'category'
      ? categoryCount
      : 1;

  const handleSendBroadcast = async () => {
    if (!message.trim()) return;
    setIsBroadcasting(true);
    setResult(null);

    try {
      const res = await fetch(`/api/events/${eventId}/passes/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: message.trim(),
          targetType,
          guestCategory: targetType === 'category' ? selectedCategory : undefined,
          passIds: targetType === 'single' ? [selectedPassId] : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setResult({
          success: false,
          message: data.error || 'Failed to dispatch push notification.',
        });
      } else {
        setResult({
          success: true,
          message: data.message || `Successfully sent lock-screen alert to ${targetCount} passes!`,
          details: data.results,
        });
        if (onBroadcastSuccess) onBroadcastSuccess();
      }
    } catch (err: any) {
      setResult({
        success: false,
        message: err?.message || 'Network error while broadcasting notification.',
      });
    } finally {
      setIsBroadcasting(false);
    }
  };

  const quickTemplates = [
    'Schedule update: Next keynote begins in Main Hall at 11:30 AM.',
    'VIP access: Networking lunch is now served in Executive Lounge 2.',
    'Venue alert: Workshop room has moved to Room 204 (2nd Floor).',
    'Welcome! Please proceed to Hall A turnstiles for fast-track badge check-in.',
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200">
      <div className="glass-panel w-full max-w-xl rounded-3xl border border-white/20 dark:border-white/10 shadow-2xl bg-theme-card/95 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-accent/15 via-transparent to-primary/10">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-accent/20 border border-accent/40 flex items-center justify-center text-accent shadow-inner">
              <Bell className="h-5 w-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-base font-bold text-theme-text-primary flex items-center gap-2">
                Broadcast Live Lock-Screen Push
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-accent/20 text-accent border border-accent/30">
                  APNs & Google
                </span>
              </h2>
              <p className="text-xs text-theme-text-secondary">{eventName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-full flex items-center justify-center text-theme-text-secondary hover:text-theme-text-primary hover:bg-white/10 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* Target Selector */}
          <div>
            <label className="block text-xs font-semibold text-theme-text-secondary uppercase tracking-wider mb-2">
              Broadcast Target ({targetCount} Recipients)
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setTargetType('all')}
                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border text-xs font-medium transition-all ${
                  targetType === 'all'
                    ? 'bg-accent/20 border-accent text-accent font-semibold shadow-sm'
                    : 'bg-white/5 border-white/10 text-theme-text-secondary hover:bg-white/10'
                }`}
              >
                <Users className="h-3.5 w-3.5" />
                All Passes ({activePasses.length})
              </button>
              <button
                type="button"
                onClick={() => setTargetType('category')}
                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border text-xs font-medium transition-all ${
                  targetType === 'category'
                    ? 'bg-accent/20 border-accent text-accent font-semibold shadow-sm'
                    : 'bg-white/5 border-white/10 text-theme-text-secondary hover:bg-white/10'
                }`}
              >
                <Layers className="h-3.5 w-3.5" />
                By Category
              </button>
              <button
                type="button"
                onClick={() => setTargetType('single')}
                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border text-xs font-medium transition-all ${
                  targetType === 'single'
                    ? 'bg-accent/20 border-accent text-accent font-semibold shadow-sm'
                    : 'bg-white/5 border-white/10 text-theme-text-secondary hover:bg-white/10'
                }`}
              >
                <User className="h-3.5 w-3.5" />
                Single Pass
              </button>
            </div>
          </div>

          {/* Category Dropdown */}
          {targetType === 'category' && (
            <div>
              <label className="block text-xs font-semibold text-theme-text-secondary mb-1.5">
                Select Guest Category
              </label>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-white/15 bg-white/5 text-sm text-theme-text-primary focus:outline-none focus:border-accent"
              >
                {PUSH_GUEST_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat} className="bg-neutral-900 text-white">
                    {cat} ({activePasses.filter((p) => (p.guestCategory || '').toLowerCase() === cat.toLowerCase()).length} passes)
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Single Pass Dropdown */}
          {targetType === 'single' && (
            <div>
              <label className="block text-xs font-semibold text-theme-text-secondary mb-1.5">
                Select Pass Holder
              </label>
              <SearchableSelect
                value={selectedPassId}
                onChange={setSelectedPassId}
                options={activePasses.map((p) => ({
                  value: p.id,
                  label: `${p.attendeeName} • ${p.guestCategory || 'Attendee'}`,
                  sublabel: p.serialNumber,
                }))}
              />
            </div>
          )}

          {/* Push Message Input */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-theme-text-secondary uppercase tracking-wider">
                Push Notification Text
              </label>
              <span className="text-[10px] text-theme-text-secondary">
                {message.length} / 160 characters
              </span>
            </div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="e.g. Keynote starting in Hall A turnstiles at 11:30 AM..."
              rows={3}
              maxLength={200}
              className="w-full px-4 py-3 rounded-2xl border border-white/15 bg-white/5 text-sm text-theme-text-primary placeholder:text-theme-text-secondary/50 focus:outline-none focus:border-accent transition-all resize-none shadow-inner"
            />
          </div>

          {/* Quick Pre-written Templates */}
          <div>
            <span className="text-[11px] font-medium text-theme-text-secondary flex items-center gap-1.5 mb-2">
              <Sparkles className="h-3 w-3 text-accent" /> Quick broadcast templates:
            </span>
            <div className="flex flex-wrap gap-1.5">
              {quickTemplates.map((tmpl, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setMessage(tmpl)}
                  className="text-[11px] text-left px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-accent/15 border border-white/10 hover:border-accent/40 text-theme-text-secondary hover:text-accent transition-all"
                >
                  {tmpl}
                </button>
              ))}
            </div>
          </div>

          {/* Feedback & Result Alert */}
          {result && (
            <div
              className={`p-4 rounded-2xl border flex items-start gap-3 text-xs ${
                result.success
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'bg-danger/10 border-danger/30 text-danger'
              }`}
            >
              {result.success ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <p className="font-semibold">{result.message}</p>
                {result.details && result.details.errors && result.details.errors.length > 0 && (
                  <ul className="mt-1 list-disc list-inside text-[11px] opacity-80">
                    {result.details.errors.map((e: string, i: number) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-white/10 bg-white/5 flex items-center justify-between">
          <p className="text-[11px] text-theme-text-secondary/70">
            Instant lock-screen alert to all Apple & Google Wallets.
          </p>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold rounded-xl text-theme-text-secondary hover:bg-white/10 transition-colors"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleSendBroadcast}
              disabled={isBroadcasting || !message.trim()}
              className="flex items-center gap-2 px-5 py-2.5 text-xs font-bold rounded-xl bg-accent hover:bg-accent/90 text-white shadow-lg shadow-accent/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isBroadcasting ? (
                <>
                  <span className="h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Broadcasting…
                </>
              ) : (
                <>
                  <Send className="h-3.5 w-3.5" />
                  Send Push ({targetCount})
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
