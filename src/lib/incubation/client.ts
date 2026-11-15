import { authHeaders } from '../local-data';
import type { IncubationSettings, Startup } from './types';

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...init, headers: authHeaders({ 'Content-Type': 'application/json' }) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data as T;
}

export const fetchIncubationSettings = () => call<IncubationSettings>('/api/incubation/settings');
export const saveIncubationSettings = (s: IncubationSettings) =>
  call<IncubationSettings>('/api/incubation/settings', { method: 'PUT', body: JSON.stringify(s) });

export const fetchStartups = () => call<Startup[]>('/api/incubation/startups');
export const createStartup = (payload: Partial<Startup>) =>
  call<Startup>('/api/incubation/startups', { method: 'POST', body: JSON.stringify(payload) });
export const updateStartup = (id: string, payload: Partial<Startup>) =>
  call<Startup>(`/api/incubation/startups/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });

export interface FounderCandidate { id: string; name: string; email: string }
/** Active tier-4 (Startup) accounts that can be linked as founders. */
export async function fetchFounderCandidates(): Promise<FounderCandidate[]> {
  const all = await call<any[]>('/api/members');
  return all.filter(m => m.tier === 4 && m.status !== 'Terminated').map(m => ({ id: m.id, name: m.name, email: m.email }));
}

// ---- Applications
import type { Application } from './types';
import type { IncubationAlert, CalendarItem } from './alerts-server';
import type { KpiReport } from './kpi-server';
import type { OnboardingRecord, GateResult } from './onboarding';

export type ApplicationView = Partial<Application> & { id: string; viewer: { isManager: boolean; assigned: boolean; coi?: string; ownScoreSubmitted: boolean }; gated?: boolean };
export const fetchApplications = () => call<ApplicationView[]>('/api/incubation/applications');
export const actOnApplication = (id: string, body: Record<string, unknown>) =>
  call<ApplicationView>(`/api/incubation/applications/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });

/** Public intake — no auth header. */
export async function submitPublicApplication(payload: unknown): Promise<{ id: string }> {
  const res = await fetch('/api/public/applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

// ---- Registers
export const fetchRecords = (kind: string) => call<any[]>(`/api/incubation/records/${kind}`);
export const createRecord = (kind: string, body: Record<string, unknown>) => call<any>(`/api/incubation/records/${kind}`, { method: 'POST', body: JSON.stringify(body) });
export const updateRecord = (kind: string, id: string, body: Record<string, unknown>) => call<any>(`/api/incubation/records/${kind}/${id}`, { method: 'PATCH', body: JSON.stringify(body) });

// ---- Onboarding
export const fetchOnboarding = (startupId: string) => call<{ startup: Startup; onboarding: OnboardingRecord; gate: GateResult }>(`/api/incubation/onboarding/${encodeURIComponent(startupId)}`);
export const saveOnboarding = (startupId: string, body: unknown) => call<GateResult>(`/api/incubation/onboarding/${encodeURIComponent(startupId)}`, { method: 'PUT', body: JSON.stringify(body) });
export const activateStartup = (startupId: string) => call<{ ok: boolean; basis: string }>(`/api/incubation/onboarding/${encodeURIComponent(startupId)}/activate`, { method: 'POST' });

// ---- Alerts / calendar / KPI
export const fetchAlerts = () => call<IncubationAlert[]>('/api/incubation/alerts');
export const fetchIncubationCalendar = () => call<CalendarItem[]>('/api/incubation/calendar');
export const fetchKpis = (fy?: string) => call<KpiReport>(`/api/incubation/kpi${fy ? `?fy=${encodeURIComponent(fy)}` : ''}`);

export async function fetchMembersLite(): Promise<{ id: string; name: string; tier: number }[]> {
  const all = await call<any[]>('/api/members');
  return all.filter(m => m.status !== 'Terminated').map(m => ({ id: m.id, name: m.name, tier: m.tier }));
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.readAsDataURL(file);
  });
}
