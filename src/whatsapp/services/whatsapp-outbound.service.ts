import { Injectable, Logger } from '@nestjs/common';

interface WhatsAppTextPayload {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'text';
  text: { body: string; preview_url?: boolean };
}

@Injectable()
export class WhatsappOutboundService {
  private readonly logger = new Logger(WhatsappOutboundService.name);
  private readonly phoneNumberId: string;
  private readonly accessToken: string;
  private readonly baseUrl: string;

  constructor() {
    this.phoneNumberId = process.env.PHONE_NUMBER_ID || '';
    this.accessToken = process.env.META_ACCESS_TOKEN || '';
    this.baseUrl = `https://graph.facebook.com/v22.0/${this.phoneNumberId}/messages`;

    if (!this.phoneNumberId || !this.accessToken) {
      this.logger.warn(
        'Missing PHONE_NUMBER_ID or META_ACCESS_TOKEN — outbound messages will fail',
      );
    }
  }

  /**
   * Sends a text message to the given WhatsApp recipient via the Meta Graph API.
   */
  async sendText(
    to: string,
    text: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.phoneNumberId || !this.accessToken) {
        throw new Error('WhatsApp credentials not configured');
      }

      const messageText = text.trim().substring(0, 4096); // WhatsApp limit
      if (!messageText) {
        throw new Error('Empty message text');
      }

      const payload: WhatsAppTextPayload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { body: messageText, preview_url: true },
      };

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data: any = await response.json();

      if (!response.ok) {
        const errorMsg =
          data?.error?.message ||
          `HTTP ${response.status}: ${response.statusText}`;
        this.logger.error(`Meta API error for ${to}: ${errorMsg}`);
        return { success: false, error: errorMsg };
      }

      const messageId = data?.messages?.[0]?.id;
      this.logger.log(
        `Message sent to ${to}${messageId ? ` (id: ${messageId})` : ''}`,
      );
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to send to ${to}: ${msg}`);
      return { success: false, error: msg };
    }
  }

  /** Returns true if the required env vars are set. */
  isConfigured(): boolean {
    return !!(this.phoneNumberId && this.accessToken);
  }
}