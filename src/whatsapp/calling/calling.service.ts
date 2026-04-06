import { Injectable, Logger } from '@nestjs/common';
import { RTCPeerConnection } from 'werift';
import type { MediaStreamTrack, RTCRtpCodecParameters } from 'werift';
import { whatsappConfig } from '../whatsapp-api/whatsapp.config';
import { GeminiLiveService, GeminiLiveSession } from './gemini-live.service';

/**
 * Handles WhatsApp call lifecycle:
 * 1. Receive SDP offer from Meta webhook
 * 2. Create WebRTC PeerConnection, generate SDP answer
 * 3. pre_accept + accept the call via Meta API
 * 4. Bridge audio between WebRTC (WhatsApp) and Gemini Live
 */

interface ActiveCall {
  callId: string;
  phoneNumber: string;
  pc: RTCPeerConnection;
  geminiSession: GeminiLiveSession;
}

@Injectable()
export class CallingService {
  private readonly logger = new Logger(CallingService.name);
  private activeCalls: Map<string, ActiveCall> = new Map();

  constructor(private readonly geminiLive: GeminiLiveService) {}

  /**
   * Handle incoming call webhook from Meta.
   */
  async handleIncomingCall(
    callId: string,
    phoneNumber: string,
    sdpOffer: string,
  ): Promise<void> {
    this.logger.log(`📞 Incoming call: ${callId} from ${phoneNumber}`);

    try {
      // 1. Create WebRTC PeerConnection
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }], // Required to get public IP
      });

      // Add audio transceiver so WebRTC generates a proper answer with m=audio
      pc.addTransceiver('audio', { direction: 'sendrecv' });

      // 2. Set remote SDP offer from Meta
      await pc.setRemoteDescription({
        type: 'offer',
        sdp: sdpOffer,
      });

      // 3. Create answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // Wait for ICE gathering to complete so we have our public IP candidates in the SDP answer
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === 'complete') {
          resolve();
        } else {
          pc.iceGatheringStateChange.subscribe((state) => {
            if (state === 'complete') resolve();
          });
        }
      });

      const sdpAnswer = pc.localDescription!.sdp;

      this.logger.log(`SDP answer generated for call ${callId}`);

      // 4. Create Gemini Live session
      const geminiSession = this.geminiLive.createSession({
        onAudio: (pcmBase64: string) => {
          this.logger.debug(`Gemini audio chunk received for call ${callId}`);
          // TODO: Send Gemini's response audio back through the WebRTC track
        },
        onText: (text: string) => {
          this.logger.log(`[Call ${callId}] Gemini: "${text.slice(0, 80)}"`);
        },
        onTurnComplete: () => {
          this.logger.debug(`[Call ${callId}] Gemini turn complete`);
        },
        onSetupComplete: () => {
          this.logger.log(`[Call ${callId}] Gemini ready for audio`);
        },
        onError: (error: string) => {
          this.logger.error(`[Call ${callId}] Gemini error: ${error}`);
        },
        onClose: () => {
          this.logger.log(`[Call ${callId}] Gemini session closed`);
        },
      });

      // 5. Set up audio track handler - capture incoming audio from WhatsApp
      pc.onTrack.subscribe((track: MediaStreamTrack) => {
        this.logger.log(
          `[Call ${callId}] Audio track received: kind=${track.kind}`,
        );

        track.onReceiveRtp.subscribe((rtp) => {
          // Convert RTP payload to base64 and send to Gemini
          const audioBase64 = Buffer.from(rtp.payload).toString('base64');
          geminiSession.sendAudio(audioBase64);
        });
      });

      // Store active call
      this.activeCalls.set(callId, {
        callId,
        phoneNumber,
        pc,
        geminiSession,
      });

      // 6. Pre-accept the call
      await this.sendCallAction(callId, 'pre_accept', sdpAnswer);
      this.logger.log(`[Call ${callId}] Pre-accepted`);

      // 7. Accept the call
      await this.sendCallAction(callId, 'accept', sdpAnswer);
      this.logger.log(`[Call ${callId}] Accepted ✅`);
    } catch (error: any) {
      this.logger.error(
        `Failed to handle call ${callId}: ${error.message}`,
        error.stack,
      );
      // Try to reject the call on error
      try {
        await this.sendCallAction(callId, 'reject');
      } catch {
        // ignore rejection errors
      }
    }
  }

  /**
   * Handle call termination webhook from Meta.
   */
  async handleCallEnd(callId: string): Promise<void> {
    this.logger.log(`📞 Call ended: ${callId}`);

    const call = this.activeCalls.get(callId);
    if (!call) {
      this.logger.warn(`No active call found for ${callId}`);
      return;
    }

    // Cleanup
    call.geminiSession.close();
    call.pc.close();
    this.activeCalls.delete(callId);

    this.logger.log(`[Call ${callId}] Cleaned up`);
  }

  /**
   * Send call action (pre_accept, accept, reject) to Meta API.
   */
  private async sendCallAction(
    callId: string,
    action: 'pre_accept' | 'accept' | 'reject',
    sdpAnswer?: string,
  ): Promise<void> {
    const url = `https://graph.facebook.com/${whatsappConfig.version}/${whatsappConfig.phoneNumberId}/calls`;

    const body: any = {
      messaging_product: 'whatsapp',
      call_id: callId,
      action,
    };

    if (sdpAnswer && (action === 'pre_accept' || action === 'accept')) {
      body.session = {
        sdp_type: 'answer',
        sdp: sdpAnswer,
      };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${whatsappConfig.accessToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      this.logger.error(`Call action ${action} failed: ${error}`);
      throw new Error(`Call action ${action} failed: ${error}`);
    }

    this.logger.debug(`Call action ${action} sent for ${callId}`);
  }
}
