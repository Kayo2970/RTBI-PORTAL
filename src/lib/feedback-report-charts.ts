import type { FeedbackAnalysis } from '@/lib/feedback-analysis';
import { RATING_PARAMS } from '@/lib/feedback-analysis';

/**
 * Draws the Word report's charts straight onto a <canvas> as PNGs (no chart library, so they never depend on what is
 * on screen or on the UI theme). The canvas is injected so the same code runs in the browser and, for testing, in
 * Node with @napi-rs/canvas.
 */

export interface ChartCanvas {
  ctx: CanvasRenderingContext2D;
  toPng(): Promise<Uint8Array>;
}
export type CanvasFactory = (width: number, height: number) => ChartCanvas;

export interface ChartImage {
  png: Uint8Array;
  width: number; // px
  height: number; // px
  alt: string;
}

export const browserCanvas: CanvasFactory = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return {
    ctx: canvas.getContext('2d') as CanvasRenderingContext2D,
    toPng: () => new Promise((resolve, reject) => {
      canvas.toBlob(async b => (b ? resolve(new Uint8Array(await b.arrayBuffer())) : reject(new Error('Chart render failed'))), 'image/png');
    }),
  };
};

const W = 1400;
const FONT = 'Calibri, "Segoe UI", Arial, sans-serif';
const INK = '#1E293B';
const MUTED = '#64748B';
const GRID = '#E2E8F0';
const ACCENT = '#2E75B6';
const GREY = '#94A3B8';
const WARN = '#F59E0B';
const SCORE_COLORS = ['#DC2626', '#F59E0B', '#94A3B8', '#60A5FA', '#2563EB'];

function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

function frame(make: CanvasFactory, height: number, title: string, subtitle?: string) {
  const c = make(W, height);
  const { ctx } = c;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, height);
  ctx.fillStyle = INK;
  ctx.font = `bold 34px ${FONT}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(title, 40, 52);
  let top = 76;
  if (subtitle) {
    ctx.fillStyle = MUTED;
    ctx.font = `24px ${FONT}`;
    ctx.fillText(subtitle, 40, 88);
    top = 108;
  }
  return { c, ctx, top };
}

interface BarItem { label: string; value: number; color?: string; lo?: number; hi?: number }

/** Horizontal bars; optional dashed reference line and confidence whiskers. */
async function hBars(make: CanvasFactory, o: {
  title: string; subtitle?: string; items: BarItem[]; max: number; target?: number; targetLabel?: string;
  fmt: (v: number) => string; min?: number; alt: string;
}): Promise<ChartImage> {
  const rowH = 58;
  const labelW = 430;
  const left = 40 + labelW;
  const right = W - 150;
  const min = o.min ?? 0;
  const head = o.subtitle ? 108 : 76;
  const height = head + o.items.length * rowH + 70;
  const { c, ctx } = frame(make, height, o.title, o.subtitle);
  const x = (v: number) => left + ((v - min) / (o.max - min)) * (right - left);
  const y0 = head + 10;

  // grid + axis
  ctx.font = `22px ${FONT}`;
  ctx.textAlign = 'center';
  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const v = min + ((o.max - min) * i) / steps;
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x(v), y0); ctx.lineTo(x(v), y0 + o.items.length * rowH); ctx.stroke();
    ctx.fillStyle = MUTED;
    ctx.fillText(o.fmt(v), x(v), y0 + o.items.length * rowH + 28);
  }
  if (min < 0 && o.max > 0) {
    ctx.strokeStyle = MUTED; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x(0), y0); ctx.lineTo(x(0), y0 + o.items.length * rowH); ctx.stroke();
  }

  o.items.forEach((it, i) => {
    const cy = y0 + i * rowH + rowH / 2;
    ctx.textAlign = 'right';
    ctx.fillStyle = INK;
    ctx.font = `25px ${FONT}`;
    ctx.fillText(fit(ctx, it.label, labelW - 16), left - 14, cy + 9);
    const base = Math.max(min, Math.min(0, o.max));
    const x1 = x(base), x2 = x(Math.max(min, Math.min(o.max, it.value)));
    ctx.fillStyle = it.color ?? ACCENT;
    ctx.fillRect(Math.min(x1, x2), cy - 17, Math.max(2, Math.abs(x2 - x1)), 34);
    if (it.lo !== undefined && it.hi !== undefined) {
      ctx.strokeStyle = INK; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x(it.lo), cy); ctx.lineTo(x(it.hi), cy);
      ctx.moveTo(x(it.lo), cy - 9); ctx.lineTo(x(it.lo), cy + 9);
      ctx.moveTo(x(it.hi), cy - 9); ctx.lineTo(x(it.hi), cy + 9);
      ctx.stroke();
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = INK;
    ctx.font = `bold 24px ${FONT}`;
    const labelX = Math.max(x1, x2, it.hi !== undefined ? x(it.hi) : 0) + 12;
    ctx.fillText(o.fmt(it.value), labelX, cy + 9);
  });

  if (o.target !== undefined) {
    ctx.strokeStyle = WARN; ctx.lineWidth = 3; ctx.setLineDash([12, 8]);
    ctx.beginPath(); ctx.moveTo(x(o.target), y0 - 6); ctx.lineTo(x(o.target), y0 + o.items.length * rowH); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = WARN; ctx.font = `bold 22px ${FONT}`; ctx.textAlign = 'left';
    ctx.fillText(o.targetLabel ?? o.fmt(o.target), x(o.target) + 8, y0 - 12 + (o.subtitle ? 0 : 0));
  }
  return { png: await c.toPng(), width: W, height, alt: o.alt };
}

/** Vertical columns (histograms, small distributions). */
async function vBars(make: CanvasFactory, o: {
  title: string; subtitle?: string; items: BarItem[]; fmt?: (v: number) => string; alt: string; xLabel?: string;
}): Promise<ChartImage> {
  const height = 560;
  const head = o.subtitle ? 108 : 76;
  const { c, ctx } = frame(make, height, o.title, o.subtitle);
  const fmt = o.fmt ?? (v => String(Math.round(v)));
  const left = 90, right = W - 40, top = head + 40, bottom = height - 90;
  const dataMax = Math.max(1, ...o.items.map(i => i.value));
  const max = dataMax <= 5 ? Math.ceil(dataMax) : Math.ceil(dataMax / 5) * 5;
  const y = (v: number) => bottom - (v / max) * (bottom - top);

  ctx.font = `22px ${FONT}`;
  const ticks = Math.min(max, 5);
  for (let i = 0; i <= ticks; i++) {
    const v = (max * i) / ticks;
    ctx.strokeStyle = GRID; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(left, y(v)); ctx.lineTo(right, y(v)); ctx.stroke();
    ctx.fillStyle = MUTED; ctx.textAlign = 'right';
    ctx.fillText(fmt(v), left - 12, y(v) + 8);
  }
  const slot = (right - left) / o.items.length;
  const bw = Math.min(150, slot * 0.62);
  o.items.forEach((it, i) => {
    const cx = left + slot * i + slot / 2;
    ctx.fillStyle = it.color ?? ACCENT;
    ctx.fillRect(cx - bw / 2, y(it.value), bw, bottom - y(it.value));
    ctx.textAlign = 'center';
    ctx.fillStyle = INK; ctx.font = `bold 24px ${FONT}`;
    ctx.fillText(fmt(it.value), cx, y(it.value) - 10);
    ctx.fillStyle = MUTED; ctx.font = `24px ${FONT}`;
    ctx.fillText(it.label, cx, bottom + 34);
  });
  if (o.xLabel) {
    ctx.fillStyle = MUTED; ctx.font = `22px ${FONT}`; ctx.textAlign = 'center';
    ctx.fillText(o.xLabel, (left + right) / 2, height - 20);
  }
  return { png: await c.toPng(), width: W, height, alt: o.alt };
}

/** 100% stacked horizontal bars, one per parameter, segments for scores 1–5. */
async function stacked(make: CanvasFactory, o: {
  title: string; subtitle?: string; rows: { label: string; pct: number[] }[]; alt: string;
}): Promise<ChartImage> {
  const rowH = 58, labelW = 430;
  const left = 40 + labelW, right = W - 40;
  const head = o.subtitle ? 108 : 76;
  const legendH = 56;
  const height = head + legendH + o.rows.length * rowH + 70;
  const { c, ctx } = frame(make, height, o.title, o.subtitle);
  const y0 = head + legendH;

  // legend
  ctx.font = `22px ${FONT}`; ctx.textAlign = 'left';
  let lx = left;
  ['1 (low)', '2', '3', '4', '5 (high)'].forEach((l, i) => {
    ctx.fillStyle = SCORE_COLORS[i]; ctx.fillRect(lx, head + 6, 26, 26);
    ctx.fillStyle = INK; ctx.fillText(l, lx + 36, head + 27);
    lx += 36 + ctx.measureText(l).width + 34;
  });

  o.rows.forEach((r, i) => {
    const cy = y0 + i * rowH + rowH / 2;
    ctx.textAlign = 'right'; ctx.fillStyle = INK; ctx.font = `25px ${FONT}`;
    ctx.fillText(fit(ctx, r.label, labelW - 16), left - 14, cy + 9);
    let x = left;
    r.pct.forEach((p, s) => {
      const w = ((right - left) * p) / 100;
      if (w <= 0) return;
      ctx.fillStyle = SCORE_COLORS[s];
      ctx.fillRect(x, cy - 19, w, 38);
      if (w > 44) {
        ctx.fillStyle = s === 2 || s === 1 ? INK : '#FFFFFF';
        ctx.font = `bold 20px ${FONT}`; ctx.textAlign = 'center';
        ctx.fillText(`${Math.round(p)}%`, x + w / 2, cy + 7);
      }
      x += w;
    });
  });
  return { png: await c.toPng(), width: W, height, alt: o.alt };
}

// ───────────────────────── the report's charts ─────────────────────────

export interface ReportCharts {
  means?: ChartImage;
  distribution?: ChartImage;
  dimensions?: ChartImage;
  overall?: ChartImage;
  respondentIndex?: ChartImage;
  outcomes?: ChartImage;
  impact?: ChartImage;
  drivers?: ChartImage;
  segments?: ChartImage;
  comments: Record<string, ChartImage | undefined>;
}

export async function buildReportCharts(a: FeedbackAnalysis, make: CanvasFactory = browserCanvas): Promise<ReportCharts> {
  const out: ReportCharts = { comments: {} };
  if (a.n === 0) return out;
  // Reference line = the event's own average (mean of the nine parameter means), not an externally set target.
  const avg = a.overallMean ?? undefined;
  const sortedParams = a.params.filter(p => p.mean !== null).sort((x, y) => (y.mean as number) - (x.mean as number));

  if (sortedParams.length) {
    out.means = await hBars(make, {
      title: 'Mean rating by parameter', subtitle: `Strongest to weakest · scale 1–5 · whiskers = 95% interval · n = ${a.n} forms`,
      items: sortedParams.map(p => ({ label: p.label, value: p.mean as number, color: avg === undefined || (p.mean as number) >= avg ? ACCENT : GREY, lo: p.ci !== null ? (p.mean as number) - p.ci : undefined, hi: p.ci !== null ? (p.mean as number) + p.ci : undefined })),
      min: 0, max: 5, target: avg, targetLabel: avg === undefined ? undefined : `Event average ${avg.toFixed(2)}`, fmt: v => v.toFixed(v % 1 === 0 && v === Math.round(v) ? 0 : 2),
      alt: 'Bar chart of mean rating per parameter with 95% confidence whiskers',
    });
    out.distribution = await stacked(make, {
      title: 'How scores are spread', subtitle: 'Share of responses giving each score (1 = low, 5 = high)',
      rows: sortedParams.map(p => ({ label: p.label, pct: p.counts.map(cn => (p.n ? (cn / p.n) * 100 : 0)) })),
      alt: '100% stacked bar chart of score distribution per parameter',
    });
  }

  const dims = a.dimensions.filter(d => d.mean !== null);
  if (dims.length) {
    out.dimensions = await hBars(make, {
      title: 'Dimension scores', subtitle: 'Design · Content · Delivery · Support (mean of related items)',
      items: dims.map(d => ({ label: d.label, value: d.mean as number, color: avg === undefined || (d.mean as number) >= avg ? ACCENT : GREY })),
      min: 0, max: 5, target: avg, targetLabel: avg === undefined ? undefined : `Event average ${avg.toFixed(2)}`, fmt: v => v.toFixed(v === Math.round(v) ? 0 : 2),
      alt: 'Bar chart of dimension scores',
    });
  }

  if (a.overall.n > 0) {
    out.overall = await vBars(make, {
      title: 'Overall rating (out of 5)', subtitle: `Mean ${(a.overall.mean ?? 0).toFixed(2)} · n = ${a.overall.n}`,
      items: a.overall.counts.map((cnt, i) => ({ label: String(i + 1), value: cnt, color: SCORE_COLORS[i] })), xLabel: 'Rating given',
      alt: 'Column chart of overall rating counts',
    });
  }

  if (a.respondentIndex) {
    out.respondentIndex = await vBars(make, {
      title: 'Each person’s average rating', subtitle: `Respondent index · mean ${a.respondentIndex.mean.toFixed(2)} · SD ${a.respondentIndex.sd.toFixed(2)} · a second peak means two audience types`,
      items: a.respondentIndex.hist.map(h => ({ label: h.bin, value: h.count })), xLabel: 'Average of the nine ratings (bins of 0.5)',
      alt: 'Histogram of respondent index',
    });
  }

  if (a.outcomes.some(o => o.n > 0)) {
    out.outcomes = await hBars(make, {
      title: 'Learning outcomes met', subtitle: `% of respondents ticking Yes · achievement index ${a.outcomeIndex === null ? '—' : Math.round(a.outcomeIndex) + '%'}`,
      items: [...a.outcomes].sort((x, y) => y.pct - x.pct).map(o => ({ label: o.short, value: o.pct })),
      min: 0, max: 100, fmt: v => `${Math.round(v)}%`, alt: 'Bar chart of percentage meeting each learning outcome',
    });
  }

  const impact: BarItem[] = [];
  if (a.knowledge.ci) impact.push({ label: 'Knowledge / skills enhanced', value: a.knowledge.ci.p * 100, lo: a.knowledge.ci.lo * 100, hi: a.knowledge.ci.hi * 100 });
  if (a.apply.ci) impact.push({ label: 'Will apply the learning', value: a.apply.ci.p * 100, lo: a.apply.ci.lo * 100, hi: a.apply.ci.hi * 100 });
  if (impact.length) {
    out.impact = await hBars(make, {
      title: 'Impact of the event', subtitle: '% answering Yes with 95% confidence interval',
      items: impact, min: 0, max: 100, fmt: v => `${Math.round(v)}%`, alt: 'Bar chart of Yes rates with confidence intervals',
    });
  }

  if (a.regression) {
    const name = (k: string) => RATING_PARAMS.find(p => p.key === k)?.short ?? k;
    const betas = [...a.regression.betas].sort((x, y) => y.beta - x.beta);
    const lim = Math.max(0.5, Math.ceil(Math.max(...betas.map(b => Math.abs(b.beta))) * 10) / 10);
    out.drivers = await hBars(make, {
      title: 'What moves the overall rating', subtitle: `Standardised regression coefficients (β) · R² ${a.regression.r2.toFixed(2)} · n = ${a.regression.n}`,
      items: betas.map(b => ({ label: name(b.key), value: b.beta, color: b.beta >= 0 ? ACCENT : '#EF4444' })),
      min: -lim, max: lim, fmt: v => v.toFixed(2), alt: 'Bar chart of standardised regression coefficients',
    });
  }

  const segs = [...a.designations, ...a.departments].filter(s => s.n >= 10);
  if (segs.length >= 2) {
    const mk = (list: typeof a.designations) => list.filter(s => s.n >= 10).map(s => ({ label: `${s.name} (n=${s.n})`, value: s.indexMean, color: !a.respondentIndex || s.indexMean >= a.respondentIndex.mean ? ACCENT : GREY }));
    const items = [...mk(a.designations), ...mk(a.departments)];
    out.segments = await hBars(make, {
      title: 'Respondent index by group', subtitle: 'Groups with 10 or more responses',
      items, min: 0, max: 5, target: a.respondentIndex?.mean, targetLabel: a.respondentIndex ? `All respondents ${a.respondentIndex.mean.toFixed(2)}` : undefined, fmt: v => v.toFixed(v === Math.round(v) ? 0 : 2),
      alt: 'Bar chart of respondent index by group',
    });
  }

  for (const cm of a.comments) {
    const themes = cm.themes.slice(0, 6);
    if (themes.length) {
      out.comments[cm.key] = await hBars(make, {
        title: cm.title, subtitle: `Respondents per theme · ${cm.answered} answered`,
        items: themes.map(t => ({ label: t.theme, value: t.respondents })),
        min: 0, max: Math.max(1, ...themes.map(t => t.respondents)), fmt: v => String(Math.round(v)),
        alt: `Bar chart of themes in ${cm.title}`,
      });
    }
  }
  return out;
}
