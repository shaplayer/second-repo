import nodemailer, { type Transporter } from "nodemailer";
import type { EmailProvider } from "../types";

/**
 * SMTP: works with Google Workspace/Gmail, Microsoft 365, Amazon SES, SendGrid,
 * Postmark, Mailgun, Zoho, your own mail server…
 * Env: SMTP_HOST, SMTP_PORT (587 or 465), SMTP_USER, SMTP_PASS, EMAIL_FROM.
 */
let transporter: Transporter | null = null;

function get(): Transporter {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT ?? 587);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }
  return transporter;
}

export const smtpEmail: EmailProvider = {
  name: "smtp",
  configured: () => Boolean(process.env.SMTP_HOST && process.env.EMAIL_FROM),
  async send(m) {
    const info = await get().sendMail({
      from: process.env.EMAIL_FROM,
      to: m.to,
      replyTo: m.replyTo,
      subject: m.subject,
      text: m.text,
      html: m.html,
    });
    return { id: info.messageId };
  },
};
