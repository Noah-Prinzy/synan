/**
 * Outbound email boundary. The provider is undecided (O-13); production plugs a
 * transactional provider in behind this interface. Dev logs to the console; tests
 * capture messages in memory.
 */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** Tag for tests and provider analytics, e.g. `auth.link`. */
  tag: string;
}

export interface Mailer {
  send(msg: MailMessage): Promise<void>;
}

export class ConsoleMailer implements Mailer {
  async send(msg: MailMessage) {
    // Dev transport only. Links in the body are single-use and short-lived.
    console.log(`\n[mail:${msg.tag}] to=${msg.to}\nsubject: ${msg.subject}\n${msg.text}\n`);
  }
}

export class MemoryMailer implements Mailer {
  readonly outbox: MailMessage[] = [];
  async send(msg: MailMessage) {
    this.outbox.push(msg);
  }
  last(tag?: string): MailMessage | undefined {
    return [...this.outbox].reverse().find((m) => !tag || m.tag === tag);
  }
}
