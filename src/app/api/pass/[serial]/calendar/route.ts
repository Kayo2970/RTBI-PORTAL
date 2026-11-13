import { NextRequest, NextResponse } from 'next/server';
import { getAppBaseUrl } from '@/lib/app-url';
import { lookupPassBySerial } from '@/lib/pass-lookup';
import { buildPassIcs } from '@/lib/pass-calendar';

export const dynamic = 'force-dynamic';

/** Email "Add to Calendar" button: server-built .ics over the pass's real valid days — no WalletWallet call. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ serial: string }> }) {
  const { serial } = await params;
  const base = getAppBaseUrl(request);
  const found = await lookupPassBySerial(serial);
  if (!found || found.pass.status === 'Cancelled' || found.archived) {
    return NextResponse.redirect(`${base}/pass/${encodeURIComponent(serial)}`, 302);
  }
  const ics = buildPassIcs(found.pass, `${base}/pass/${found.pass.serialNumber}`);
  return new NextResponse(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${found.pass.serialNumber}.ics"`,
    },
  });
}
