import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { Env } from '../../../config/env.schema';

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter?: Transporter;
  private readonly from: string;
  private readonly ttlMin: number;

  constructor(config: ConfigService<Env, true>) {
    this.from = config.get('MAIL_FROM', { infer: true });
    this.ttlMin = config.get('OTP_TTL_MINUTES', { infer: true });

    if (config.get('MAIL_TRANSPORT', { infer: true }) === 'smtp') {
      const port = config.get('SMTP_PORT', { infer: true });
      const user = config.get('SMTP_USER', { infer: true });
      const pass = config.get('SMTP_PASS', { infer: true });
      this.transporter = nodemailer.createTransport({
        host: config.get('SMTP_HOST', { infer: true }),
        port,
        secure: port === 465,
        auth: user && pass ? { user, pass } : undefined,
      });
    }
  }

  sendVerificationCode(to: string, name: string, code: string) {
    return this.codeEmail(to, name, code, 'Verify your ProBase account', 'verify your email');
  }

  sendPasswordResetCode(to: string, name: string, code: string) {
    return this.codeEmail(to, name, code, 'Reset your ProBase password', 'reset your password');
  }

  private codeEmail(to: string, name: string, code: string, subject: string, action: string) {
    const text =
      `Hi ${name},\n\nUse this code to ${action}: ${code}\n\n` +
      `It expires in ${this.ttlMin} minutes. If you didn't ask for this, you can ignore this email.`;
    const html =
      `<p>Hi ${escapeHtml(name)},</p>` +
      `<p>Use this code to ${action}:</p>` +
      `<p style="font-size:28px;letter-spacing:6px;font-weight:bold">${code}</p>` +
      `<p>It expires in ${this.ttlMin} minutes. If you didn't ask for this, you can ignore this email.</p>`;
    return this.send(to, subject, text, html);
  }

  private async send(to: string, subject: string, text: string, html: string) {
    if (!this.transporter) {
      // Development only: the env schema rejects this mode in production
      this.logger.warn(`[mail:console] to=${to} subject="${subject}"\n${text}`);
      return;
    }
    await this.transporter.sendMail({ from: this.from, to, subject, text, html });
  }
}