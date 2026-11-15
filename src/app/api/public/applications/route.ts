import { NextResponse } from 'next/server';
import { mutateCollection } from '@/lib/server-db';
import { saveBase64File, deleteStoredFilesForRecord } from '@/lib/file-storage';
import { apiError } from '@/lib/api-error';
import { dispatchEmail } from '@/lib/email-service';
import { loadSettings } from '@/lib/incubation/records-server';
import { nextApplicationId } from '@/lib/incubation/applications-server';
import { addWorkingDays } from '@/lib/incubation/rules';
import { APPLICATION_SECTIONS, type Application } from '@/lib/incubation/types';

export const maxDuration = 60;
const MAX_FILES = 8;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Public, unauthenticated application intake (rate-limited by proxy.ts as a public surface). */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (typeof body.hp === 'string' && body.hp.trim()) return NextResponse.json({ ok: true }); // honeypot — pretend success

    const applicantName = String(body.applicantName || '').trim().slice(0, 200);
    const applicantEmail = String(body.applicantEmail || '').trim().toLowerCase().slice(0, 200);
    if (!applicantName) return NextResponse.json({ error: 'Your name is required.' }, { status: 400 });
    if (!EMAIL.test(applicantEmail)) return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 });

    const sections: Record<string, string> = {};
    for (const sec of APPLICATION_SECTIONS) {
      for (const f of sec.fields) {
        const v = typeof body.sections?.[f.key] === 'string' ? body.sections[f.key].trim().slice(0, 6000) : '';
        if (f.required && !v) return NextResponse.json({ error: `Section ${sec.key}: "${f.label}" is required.` }, { status: 400 });
        if (v) sections[f.key] = v;
      }
    }
    const decl = body.declaration || {};
    if (decl.accepted !== true || !String(decl.signedName || '').trim()) {
      return NextResponse.json({ error: 'Section L: accept the declaration and type your name as the signature.' }, { status: 400 });
    }

    const files: any[] = Array.isArray(body.files) ? body.files : [];
    if (files.length > MAX_FILES) return NextResponse.json({ error: `At most ${MAX_FILES} attachments.` }, { status: 400 });
    for (const f of files) {
      if (typeof f?.dataUrl !== 'string' || !f.dataUrl.startsWith('data:')) return NextResponse.json({ error: 'Invalid attachment.' }, { status: 400 });
      if (Math.floor((f.dataUrl.length * 3) / 4) > MAX_FILE_BYTES) return NextResponse.json({ error: `"${f.name || 'File'}" exceeds the 10 MB limit.` }, { status: 400 });
    }

    const settings = await loadSettings();
    const now = new Date();
    let created!: Application;
    await mutateCollection<Application>('applications', (cur) => {
      const id = nextApplicationId(cur.map(a => a.id), now);
      created = {
        id, receivedAt: now.toISOString(), ackDueBy: addWorkingDays(now, settings.timers.acknowledgementWorkingDays).toISOString(),
        status: 'Received', applicantEmail, applicantName, sections,
        declaration: { accepted: true, signedName: String(decl.signedName).trim().slice(0, 200), signedDate: now.toISOString().slice(0, 10) },
        files: [], missingDocs: [], assigned: [], coi: [], scorecards: [],
        log: [{ at: now.toISOString(), by: 'applicant', action: 'Application received' }],
      };
      return [created, ...cur];
    });

    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const stored = await saveBase64File('applications', created.id, i, String(f.name || 'file'), f.dataUrl);
        created.files.push({ name: String(f.name || 'file'), url: stored.url, storageKey: stored.storageKey, type: typeof f.type === 'string' ? f.type : undefined, label: typeof f.label === 'string' ? f.label.slice(0, 120) : undefined });
      }
      await mutateCollection<Application>('applications', cur => cur.map(a => (a.id === created.id ? { ...a, files: created.files } : a)));
    } catch (e) {
      await deleteStoredFilesForRecord('applications', created.id);
      throw e;
    }

    // Automatic acknowledgement (timestamped, with the application ID).
    try {
      await dispatchEmail({
        to: applicantEmail, category: 'SYSTEM', subject: `RTBI application received — ${created.id}`,
        bodyText: `Dear ${applicantName},\n\nWe have received your application for the RTBI incubation programme.\nYour application ID is ${created.id} (received ${now.toISOString().slice(0, 10)}).\n\nScreening is administrative and does not replace merit evaluation. If anything is missing we will write to you with a deadline. Please quote this ID in any correspondence.\n\nRTBI`,
      });
      await mutateCollection<Application>('applications', cur => cur.map(a => (a.id === created.id
        ? { ...a, acknowledgedAt: new Date().toISOString(), log: [...a.log, { at: new Date().toISOString(), by: 'system', action: 'Acknowledgement emailed' }] } : a)));
    } catch (e) {
      console.error('[public-applications] acknowledgement email failed', e);
    }
    return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
  } catch (err) {
    return apiError(err, 'public-applications-post', 400);
  }
}
