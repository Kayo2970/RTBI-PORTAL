'use client';

import React, { useEffect, useState } from 'react';
import { FileDown } from 'lucide-react';
import { fetchRecords, fetchStartups } from '@/lib/incubation/client';
import { downloadPdf } from '@/lib/incubation/pdf';
import { momSections, programmeReportSections, startupReportSections } from '@/lib/incubation/reports';
import type { Startup } from '@/lib/incubation/types';
import { PageHeader, Panel, btnPrimary, inputCls } from '@/components/incubation/ui';

const KINDS_USED = ['trl', 'review', 'progress', 'milestone', 'mentorSession', 'agreement', 'evidence', 'programEvent', 'meeting'];
const FORMATS = ['Startup comprehensive report', 'Programme report', 'Minutes of Meeting (MOM)'] as const;

export default function ReportsPage() {
  const [startups, setStartups] = useState<Startup[]>([]);
  const [rec, setRec] = useState<Record<string, any[]>>({});
  const [format, setFormat] = useState<(typeof FORMATS)[number]>(FORMATS[0]);
  const [startupId, setStartupId] = useState('');
  const [meetingId, setMeetingId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [st, ...lists] = await Promise.all([fetchStartups(), ...KINDS_USED.map(k => fetchRecords(k).catch(() => []))]);
        setStartups(st); setRec(Object.fromEntries(KINDS_USED.map((k, i) => [k, lists[i]])));
      } catch (e: any) { setErr(e.message); }
    })();
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const download = () => {
    setErr('');
    if (format === FORMATS[0]) {
      const s = startups.find(x => x.id === startupId);
      if (!s) return setErr('Choose a startup.');
      downloadPdf(`startup-report-${s.id}.pdf`, `Startup progress report — ${s.name}`, `${s.id} · generated ${today}`, startupReportSections(s, rec));
    } else if (format === FORMATS[1]) {
      downloadPdf(`programme-report-${today}.pdf`, 'RTBI programme report', `Generated ${today}`, programmeReportSections(rec, from, to));
    } else {
      const m = (rec.meeting || []).find(x => x.id === meetingId);
      if (!m) return setErr('Choose a meeting.');
      downloadPdf(`mom-${m.date}.pdf`, `Minutes of Meeting — ${m.body}`, `Held on ${m.date}`, momSections(m));
    }
  };

  return (
    <div className="p-6 md:p-8 space-y-6">
      <PageHeader title="Reports" subtitle="Download startup, programme and meeting reports as PDF. Templates only — letterhead and final wording follow the RTBI SOPs and KITS formats once supplied." />
      <Panel>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <label className="block"><span className="block mb-1">Report format</span>
            <select className={inputCls} value={format} onChange={e => setFormat(e.target.value as any)}>{FORMATS.map(f => <option key={f}>{f}</option>)}</select></label>
          {format === FORMATS[0] && <label className="block"><span className="block mb-1">Startup</span>
            <select className={inputCls} value={startupId} onChange={e => setStartupId(e.target.value)}><option value="">—</option>{startups.map(s => <option key={s.id} value={s.id}>{s.id} — {s.name}</option>)}</select></label>}
          {format === FORMATS[1] && <>
            <label className="block"><span className="block mb-1">From</span><input type="date" className={inputCls} value={from} onChange={e => setFrom(e.target.value)} /></label>
            <label className="block"><span className="block mb-1">To</span><input type="date" className={inputCls} value={to} onChange={e => setTo(e.target.value)} /></label></>}
          {format === FORMATS[2] && <label className="block"><span className="block mb-1">Meeting</span>
            <select className={inputCls} value={meetingId} onChange={e => setMeetingId(e.target.value)}><option value="">—</option>{(rec.meeting || []).map(m => <option key={m.id} value={m.id}>{m.date} — {m.body}</option>)}</select></label>}
        </div>
        {err && <div className="text-xs text-red-400 mt-3">{err}</div>}
        <div className="mt-4"><button className={btnPrimary} onClick={download}><FileDown size={14} /> Download PDF</button></div>
      </Panel>
    </div>
  );
}
