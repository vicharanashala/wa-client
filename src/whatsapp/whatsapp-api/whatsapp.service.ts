import { Injectable, Logger } from '@nestjs/common';
import { whatsappConfig } from './whatsapp.config';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  private isAuthErrorPayload(rawError: string): boolean {
    try {
      const parsed = JSON.parse(rawError);
      return parsed?.error?.code === 190;
    } catch {
      return rawError.includes('"code":190');
    }
  }

  async sendTextMessage(
    to: string,
    text: string,
    replyToMessageId?: string,
  ): Promise<void> {
    const MAX_LENGTH = 4000;

    if (text.length <= MAX_LENGTH) {
      await this.sendSingleTextMessage(to, text, replyToMessageId);
      return;
    }

    let currentIndex = 0;
    while (currentIndex < text.length) {
      let breakIndex = currentIndex + MAX_LENGTH;

      if (breakIndex < text.length) {
        // Try to break at a double newline (paragraph) first
        const lastDoubleNewline = text.lastIndexOf('\n\n', breakIndex);
        if (lastDoubleNewline > currentIndex + MAX_LENGTH - 1500) {
          breakIndex = lastDoubleNewline;
        } else {
          // Try to break at a newline to keep formatting clean
          const lastNewline = text.lastIndexOf('\n', breakIndex);
          if (lastNewline > currentIndex + MAX_LENGTH - 1000) {
            breakIndex = lastNewline;
          } else {
            // If no good newline, try keeping words intact
            const lastSpace = text.lastIndexOf(' ', breakIndex);
            if (lastSpace > currentIndex) {
              breakIndex = lastSpace;
            }
          }
        }
      }

      const chunk = text.slice(currentIndex, breakIndex).trim();

      if (chunk.length > 0) {
        await this.sendSingleTextMessage(to, chunk, replyToMessageId);
        // Small delay to ensure messages arrive in sequential order
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      currentIndex = breakIndex;
    }
  }

  private async sendSingleTextMessage(
    to: string,
    text: string,
    replyToMessageId?: string,
  ): Promise<void> {
    const buildBody = (withContext: boolean) =>
      JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        ...(withContext && replyToMessageId
          ? { context: { message_id: replyToMessageId } }
          : {}),
        type: 'text',
        text: {
          preview_url: false,
          body: text,
        },
      });

    const post = (body: string) =>
      fetch(whatsappConfig.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${whatsappConfig.accessToken}`,
        },
        body,
      });

    let response = await post(buildBody(true));

    // If a reply-context send failed because the referenced message is
    // stale/invalid (common when reviewer answers come back days later or
    // the original wamid has rolled off WhatsApp's index), drop the context
    // and retry so the user still receives the answer — just without the
    // quoted-reply bubble.
    if (!response.ok && replyToMessageId) {
      const errorText = await response.text();
      if (this.isContextRejectionPayload(errorText)) {
        this.logger.warn(
          `WhatsApp rejected reply context for ${to} (msg_id=${replyToMessageId}); retrying without quote. Error: ${errorText}`,
        );
        response = await post(buildBody(false));
        if (!response.ok) {
          const retryError = await response.text();
          if (this.isAuthErrorPayload(retryError)) {
            this.logger.warn(`WhatsApp auth error while sending message to ${to}`);
          } else {
            this.logger.error(`Failed to send message to ${to}: ${retryError}`);
          }
        }
        return;
      }

      // Non-context failure: fall through to the standard error path so we
      // don't double-read the body.
      if (this.isAuthErrorPayload(errorText)) {
        this.logger.warn(`WhatsApp auth error while sending message to ${to}`);
      } else {
        this.logger.error(`Failed to send message to ${to}: ${errorText}`);
      }
      return;
    }

    if (!response.ok) {
      const error = await response.text();
      if (this.isAuthErrorPayload(error)) {
        this.logger.warn(`WhatsApp auth error while sending message to ${to}`);
      } else {
        this.logger.error(`Failed to send message to ${to}: ${error}`);
      }
    }
  }

  /**
   * Heuristically detect WhatsApp Cloud API error payloads that indicate the
   * `context.message_id` reference is the cause of the failure. Covers:
   *   - 100  : "Param message_id must be a valid message id"
   *   - 131009: "Parameter value is not valid"
   *   - Any payload that explicitly mentions context / message_id in the text.
   * Conservative on purpose — we only want to retry without context when we
   * are reasonably sure that's why the original send failed.
   */
  private isContextRejectionPayload(rawError: string): boolean {
    try {
      const parsed = JSON.parse(rawError);
      const code = parsed?.error?.code;
      const errData = parsed?.error?.error_data;
      const details: string = (
        parsed?.error?.message ??
        parsed?.error?.error_user_msg ??
        errData?.details ??
        ''
      ).toString();

      if (code === 131009) return true;
      if (code === 100 && /message[_ ]id|context/i.test(details)) return true;
      if (/context\.message_id|context message_id/i.test(details)) return true;
      return false;
    } catch {
      return /context\.message_id|context message_id/i.test(rawError);
    }
  }

  async markAsRead(messageId: string): Promise<void> {
    await fetch(whatsappConfig.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${whatsappConfig.accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      }),
    });
  }

  async showTyping(messageId: string): Promise<void> {
    await fetch(whatsappConfig.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${whatsappConfig.accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
        typing_indicator: { type: 'text' },
      }),
    });
  }

  async sendLocationRequest(to: string): Promise<void> {
    const response = await fetch(whatsappConfig.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${whatsappConfig.accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        type: 'interactive',
        to,
        interactive: {
          type: 'location_request_message',
          body: {
            text: 'To give you accurate farming advice, please share your location once.',
          },
          action: {
            name: 'send_location',
          },
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      if (this.isAuthErrorPayload(error)) {
        this.logger.warn(`WhatsApp auth error while requesting location from ${to}`);
      } else {
        this.logger.error(`Location request to ${to} failed: ${error}`);
      }
    }
  }

  async downloadMedia(
    mediaId: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    // Step 1: Get media URL
    const urlResponse = await fetch(
      `https://graph.facebook.com/${whatsappConfig.version}/${mediaId}`,
      {
        headers: { Authorization: `Bearer ${whatsappConfig.accessToken}` },
      },
    );

    if (!urlResponse.ok)
      throw new Error(`Failed to get media URL for ${mediaId}`);

    const { url, mime_type } = (await urlResponse.json()) as {
      url: string;
      mime_type: string;
    };

    // Step 2: Download the actual file
    const fileResponse = await fetch(url, {
      headers: { Authorization: `Bearer ${whatsappConfig.accessToken}` },
    });

    if (!fileResponse.ok)
      throw new Error(`Failed to download media from ${url}`);

    const arrayBuffer = await fileResponse.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType: mime_type,
    };
  }

  async uploadMedia(audioBuffer: Buffer, mimeType: string): Promise<string> {
    const formData = new FormData();
    // @ts-ignore
    const blob = new Blob([audioBuffer], { type: 'audio/ogg' }); // ← must be audio/ogg
    formData.append('file', blob, 'reply.ogg'); // ← .ogg extension
    formData.append('messaging_product', 'whatsapp');
    formData.append('type', 'audio/ogg'); // ← must match

    const response = await fetch(
      `https://graph.facebook.com/${whatsappConfig.version}/${whatsappConfig.phoneNumberId}/media`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${whatsappConfig.accessToken}` },
        body: formData,
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to upload media: ${error}`);
    }

    const { id } = (await response.json()) as { id: string };
    return id;
  }

  async sendVoiceMessage(
    to: string,
    mediaId: string,
    replyToMessageId?: string,
  ): Promise<void> {
    const buildBody = (withContext: boolean) =>
      JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        ...(withContext && replyToMessageId
          ? { context: { message_id: replyToMessageId } }
          : {}),
        type: 'audio',
        audio: {
          id: mediaId,
          voice: true,
        },
      });

    const post = (body: string) =>
      fetch(whatsappConfig.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${whatsappConfig.accessToken}`,
        },
        body,
      });

    let response = await post(buildBody(true));

    if (!response.ok && replyToMessageId) {
      const errorText = await response.text();
      if (this.isContextRejectionPayload(errorText)) {
        this.logger.warn(
          `WhatsApp rejected voice reply context for ${to}; retrying without quote.`,
        );
        response = await post(buildBody(false));
      } else {
        this.throwVoiceSendError(to, errorText);
      }
    }

    if (!response.ok) {
      const error = await response.text();
      this.throwVoiceSendError(to, error);
    }

    this.logger.log(`Voice message sent to ${to} with mediaId ${mediaId}`);
  }

  private throwVoiceSendError(to: string, rawError: string): never {
    if (this.isAuthErrorPayload(rawError)) {
      this.logger.warn(`WhatsApp auth error while sending voice message to ${to}`);
    }
    throw new Error(`Failed to send voice message to ${to}: ${rawError}`);
  }
}
