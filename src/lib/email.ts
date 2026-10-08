import nodemailer from "nodemailer";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

export type EmailMessage = { to: string; subject: string; text: string };

/** Swap the implementation to use any provider (SES, Resend, Mailgun HTTP API...). */
export interface EmailAdapter {
  send(message: EmailMessage): Promise<void>;
}

class SmtpAdapter implements EmailAdapter {
  private transport = nodemailer.createTransport({
    host: env().SMTP_HOST,
    port: env().SMTP_PORT,
    secure: env().SMTP_SECURE,
    auth: env().SMTP_USER ? { user: env().SMTP_USER, pass: env().SMTP_PASSWORD } : undefined,
  });
  async send(m: EmailMessage) {
    await this.transport.sendMail({ from: env().EMAIL_FROM, to: m.to, subject: m.subject, text: m.text });
  }
}

/** Development fallback: prints the message (including links) to the server log. */
class ConsoleAdapter implements EmailAdapter {
  async send(m: EmailMessage) {
    logger.warn({ to: m.to, subject: m.subject, body: m.text }, "SMTP not configured; email not sent (dev log only)");
  }
}

let adapter: EmailAdapter | undefined;
export function emailAdapter(): EmailAdapter {
  adapter ??= env().SMTP_HOST ? new SmtpAdapter() : new ConsoleAdapter();
  return adapter;
}

export async function sendVerificationEmail(to: string, token: string) {
  const link = `${env().APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
  await emailAdapter().send({
    to,
    subject: "Verify your email for MDC Practice",
    text: `Welcome! Confirm your email address by opening this link (valid for 24 hours):\n\n${link}\n\nIf you did not sign up, ignore this message.`,
  });
}

export async function sendPasswordResetEmail(to: string, token: string) {
  const link = `${env().APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  await emailAdapter().send({
    to,
    subject: "Reset your MDC Practice password",
    text: `Open this link to choose a new password (valid for 1 hour):\n\n${link}\n\nIf you did not ask for this, ignore this message.`,
  });
}
