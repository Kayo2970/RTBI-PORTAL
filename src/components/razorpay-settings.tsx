'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CreditCard, Save, CheckCircle2, Copy } from 'lucide-react';
import { api } from '@/lib/billing-client';

interface GatewayView {
  enabled: boolean; keyId: string; hasKeySecret: boolean; hasWebhookSecret: boolean;
  mode: 'live' | 'test' | null; updatedAt: string | null; updatedBy: string | null;
}

/** Super User only: Razorpay API keys + webhook secret for collecting and verifying invoice payments. */
export function RazorpaySettings() {
  const [view, setView] = useState<GatewayView | null>(null);
  const [keyId, setKeyId] = useState('');
  const [keySecret, setKeySecret] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState<'' | 'save' | 'test'>('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [origin, setOrigin] = useState('');

  const load = useCallback(async () => {
    try {
      const v = await api<GatewayView>('/api/payment-gateway');
      setView(v); setKeyId(v.keyId); setEnabled(v.enabled);
    } catch (e: any) { setMsg({ ok: false, text: e.message }); }
  }, []);
  useEffect(() => { setOrigin(window.location.origin); load(); }, [load]);

  const save = async () => {
    setBusy('save'); setMsg(null);
    try {
      const v = await api<GatewayView>('/api/payment-gateway', 'PUT', { keyId, keySecret, webhookSecret, enabled });
      setView(v); setEnabled(v.enabled); setKeySecret(''); setWebhookSecret('');
      setMsg({ ok: true, text: 'Saved. Secrets are encrypted at rest and are not shown again.' });
    } catch (e: any) { setMsg({ ok: false, text: e.message }); } finally { setBusy(''); }
  };

  const test = async () => {
    setBusy('test'); setMsg(null);
    try {
      const r = await api<{ ok: boolean; message: string }>('/api/payment-gateway/test', 'POST', {});
      setMsg({ ok: r.ok, text: r.message });
    } catch (e: any) { setMsg({ ok: false, text: e.message }); } finally { setBusy(''); }
  };

  const input = 'w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent text-xs font-mono';
  const webhookUrl = `${origin}/api/payments/razorpay/webhook`;

  return (
    <div className="glass-panel rounded-2xl p-6 space-y-4 mt-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-theme-text-primary flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-accent-strong dark:text-accent-soft" /> Razorpay — online payment collection
          </h3>
          <p className="text-xs text-theme-text-secondary max-w-2xl">
            Lets people pay an invoice online (UPI, cards, net banking). Each payment is verified on the server — signature check plus a confirmation
            fetched from Razorpay — before the invoice is marked Paid and booked to income. Get the keys from Razorpay Dashboard → Account &amp; Settings → API Keys.
          </p>
        </div>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${view?.enabled ? 'bg-success/15 text-success dark:text-success-soft' : 'bg-theme-border/30 text-theme-text-secondary'}`}>
          {view === null ? '…' : view.enabled ? `On · ${view.mode} mode` : 'Off'}
        </span>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="space-y-1 text-xs font-semibold text-theme-text-secondary">Key ID
          <input value={keyId} onChange={e => setKeyId(e.target.value)} placeholder="rzp_test_xxxxxxxxxxxxxx" className={input} autoComplete="off" />
        </label>
        <label className="space-y-1 text-xs font-semibold text-theme-text-secondary">Key Secret {view?.hasKeySecret && <span className="font-normal text-success dark:text-success-soft">· saved</span>}
          <input type="password" value={keySecret} onChange={e => setKeySecret(e.target.value)} placeholder={view?.hasKeySecret ? '•••••••• (leave blank to keep)' : 'Key Secret'} className={input} autoComplete="new-password" />
        </label>
        <label className="space-y-1 text-xs font-semibold text-theme-text-secondary sm:col-span-2">Webhook Secret {view?.hasWebhookSecret && <span className="font-normal text-success dark:text-success-soft">· saved</span>}
          <input type="password" value={webhookSecret} onChange={e => setWebhookSecret(e.target.value)} placeholder={view?.hasWebhookSecret ? '•••••••• (leave blank to keep)' : 'The secret you set when creating the webhook'} className={input} autoComplete="new-password" />
        </label>
      </div>

      <div className="rounded-xl border border-theme-card-border bg-theme-background/30 p-3 text-xs text-theme-text-secondary space-y-1.5">
        <div className="font-semibold text-theme-text-primary">Webhook (recommended — settles payments even if the payer closes the tab)</div>
        <div>In Razorpay Dashboard → Webhooks, add this URL (it must be publicly reachable over HTTPS) with events <span className="font-mono">payment.captured</span> and <span className="font-mono">order.paid</span>, and paste the secret above:</div>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate px-2 py-1 rounded-lg bg-theme-card-border/30 font-mono">{webhookUrl}</code>
          <button type="button" onClick={() => navigator.clipboard?.writeText(webhookUrl)} className="p-1.5 rounded-lg hover:bg-theme-border/30 cursor-pointer" aria-label="Copy webhook URL"><Copy className="h-3.5 w-3.5" /></button>
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs font-semibold text-theme-text-primary cursor-pointer">
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /> Allow online payment on invoices
      </label>

      <div className="flex flex-wrap items-center gap-2.5">
        <button type="button" onClick={save} disabled={!!busy} className="flex items-center gap-2 px-5 py-2.5 bg-accent hover:bg-primary-light text-white text-xs font-semibold rounded-xl cursor-pointer disabled:opacity-50">
          <Save className="h-4 w-4" /> {busy === 'save' ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={test} disabled={!!busy || !view?.hasKeySecret} className="flex items-center gap-2 px-4 py-2.5 border border-theme-card-border text-xs font-semibold rounded-xl cursor-pointer disabled:opacity-50">
          <CheckCircle2 className="h-4 w-4" /> {busy === 'test' ? 'Checking…' : 'Test connection'}
        </button>
        {view?.updatedAt && <span className="text-xs text-theme-text-secondary">Last saved {new Date(view.updatedAt).toLocaleString()} by {view.updatedBy}</span>}
      </div>
      {msg && <p role="status" className={`text-xs font-semibold ${msg.ok ? 'text-success dark:text-success-soft' : 'text-danger dark:text-danger-soft'}`}>{msg.text}</p>}
    </div>
  );
}
