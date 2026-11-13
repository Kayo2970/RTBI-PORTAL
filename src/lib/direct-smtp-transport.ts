import SMTPConnection from 'nodemailer/lib/smtp-connection';
import type { Transport, SentMessageInfo } from 'nodemailer';
import type MailMessage from 'nodemailer/lib/mailer/mail-message';
import dns from 'dns';

/**
 * Built-in direct-send outbound mail engine.
 *
 * Resolves each recipient's MX records via DNS and delivers the message
 * straight to their mail server over SMTP — no relay, no third-party API,
 * nothing outside this process. Implemented as a Nodemailer "custom
 * transport" plugin (https://nodemailer.com/plugins/create/#transports), so
 * DKIM signing, MIME building, and attachment handling all still happen the
 * normal Nodemailer way (in Mailer/MailComposer, before `send()` is ever
 * called) — this file only implements the actual network delivery step.
 *
 * For this to land in inboxes rather than bounce/junk, the sending domain
 * needs real MX/SPF/DKIM/DMARC DNS records, a reverse-DNS (PTR) record on
 * the VPS's IP matching `heloHostname`, and outbound TCP port 25 open on
 * the VPS (many hosting providers block it by default) — see the Direct
 * Send section of the dashboard's Email settings for the exact records.
 */
export interface DirectSendTransportOptions {
  heloHostname: string;
  connectionTimeout?: number;
  greetingTimeout?: number;
  socketTimeout?: number;
}

interface DeliveryResult {
  accepted: string[];
  rejected: string[];
  response: string;
}

function groupRecipientsByDomain(addresses: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const addr of addresses || []) {
    const domain = addr.split('@')[1]?.toLowerCase();
    if (!domain) continue;
    if (!groups.has(domain)) groups.set(domain, []);
    groups.get(domain)!.push(addr);
  }
  return groups;
}

async function resolveMxHosts(domain: string): Promise<string[]> {
  try {
    const records = await dns.promises.resolveMx(domain);
    if (records && records.length > 0) {
      return records.sort((a, b) => a.priority - b.priority).map((r) => r.exchange);
    }
  } catch {
    // No MX records (or the lookup itself failed) — fall through to the
    // RFC 5321 §5.1 fallback of connecting to the domain's own A/AAAA record.
  }
  return [domain];
}

function deliverToHost(
  host: string,
  from: string,
  to: string[],
  rawMessage: Buffer,
  options: DirectSendTransportOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const connection = new SMTPConnection({
      host,
      port: 25,
      name: options.heloHostname,
      secure: false,
      family: 4, // Force IPv4 for direct SMTP connections to avoid Microsoft/Gmail IPv6 rejection
      // Encrypt whenever the receiving server offers STARTTLS, but don't
      // hard-fail delivery when it doesn't — matches how real MTAs behave
      // for MTA-to-MTA hops.
      opportunisticTLS: true,
      tls: { rejectUnauthorized: false },
      connectionTimeout: options.connectionTimeout ?? 15000,
      greetingTimeout: options.greetingTimeout ?? 15000,
      socketTimeout: options.socketTimeout ?? 30000,
      logger: false,
    } as any);

    let settled = false;
    const finish = (err: Error | null, response?: string) => {
      if (settled) return;
      settled = true;
      connection.close();
      if (err) reject(err);
      else resolve(response || '250 OK');
    };

    connection.once('error', (err) => finish(err));
    connection.connect(() => {
      connection.send({ from, to }, rawMessage, (err, info) => {
        if (err) finish(err);
        else finish(null, info.response);
      });
    });
  });
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

export class DirectSendTransport implements Transport {
  name = 'DirectSend';
  version = '1.0.0';
  private options: DirectSendTransportOptions;

  constructor(options: DirectSendTransportOptions) {
    this.options = options;
  }

  send(mail: MailMessage, callback: (err: Error | null, info?: SentMessageInfo) => void): void {
    this.deliver(mail).then(
      (result) => callback(null, result as unknown as SentMessageInfo),
      (err) => callback(err instanceof Error ? err : new Error(String(err))),
    );
  }

  private async deliver(mail: MailMessage): Promise<DeliveryResult> {
    const envelope = mail.message.getEnvelope();
    const from = typeof envelope.from === 'string' ? envelope.from : '';
    const rawMessage = await streamToBuffer(mail.message.createReadStream());

    const accepted: string[] = [];
    const rejected: string[] = [];
    let response = '';
    let lastError: Error | undefined;

    for (const [domain, addrs] of groupRecipientsByDomain(envelope.to)) {
      const mxHosts = await resolveMxHosts(domain);
      let delivered = false;
      for (const host of mxHosts) {
        try {
          response = await deliverToHost(host, from, addrs, rawMessage, this.options);
          accepted.push(...addrs);
          delivered = true;
          break;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
        }
      }
      if (!delivered) rejected.push(...addrs);
    }

    if (accepted.length === 0) {
      throw lastError || new Error('No recipient mail server accepted the message');
    }

    return { accepted, rejected, response };
  }
}
