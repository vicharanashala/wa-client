import { Injectable, Logger } from '@nestjs/common';
import { RTCPeerConnection, RtpPacket, RtpHeader } from 'werift';
import type { MediaStreamTrack, RTCRtpCodecParameters, RTCRtpTransceiver } from 'werift';
import { whatsappConfig } from '../whatsapp-api/whatsapp.config';
import { GeminiLiveService, GeminiLiveSession } from './gemini-live.service';
import { AudioCodecService } from './audio-codec.service';

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
  transceiver: RTCRtpTransceiver;
  silenceInterval?: ReturnType<typeof setInterval>;
  rtpPacingInterval?: ReturnType<typeof setInterval>;
  rtpFrameQueue: Buffer[];
  /** RTP state for outbound packets */
  rtpSeq: number;
  rtpTimestamp: number;
  rtpSsrc: number;
  geminiSpeaking: boolean;
}

// Opus RTP constants
const OPUS_PAYLOAD_TYPE = 111; // matches WhatsApp's SDP: a=rtpmap:111 opus/48000/2
const OPUS_CLOCK_RATE = 48000;
const OPUS_FRAME_DURATION_MS = 20;
const OPUS_TIMESTAMP_INCREMENT = (OPUS_CLOCK_RATE * OPUS_FRAME_DURATION_MS) / 1000; // 960

@Injectable()
export class CallingService {
  private readonly logger = new Logger(CallingService.name);
  private activeCalls: Map<string, ActiveCall> = new Map();

  constructor(
    private readonly geminiLive: GeminiLiveService,
    private readonly audioCodec: AudioCodecService,
  ) {}

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
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });

      // ── ICE/DTLS state logging ──
      pc.iceConnectionStateChange.subscribe((state) => {
        this.logger.log(`[Call ${callId}] ICE connection state: ${state}`);
      });
      pc.connectionStateChange.subscribe((state) => {
        this.logger.log(`[Call ${callId}] Connection state: ${state}`);
      });
      pc.iceGatheringStateChange.subscribe((state) => {
        this.logger.debug(`[Call ${callId}] ICE gathering state: ${state}`);
      });

      // 2. Add audio transceiver for send+recv
      const transceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });

      // 3. Subscribe to onTrack BEFORE setRemoteDescription (critical!)
      //    In werift, onTrack fires during setRemoteDescription
      pc.onTrack.subscribe((track: MediaStreamTrack) => {
        this.logger.log(
          `[Call ${callId}] ✅ Audio track received: kind=${track.kind}, ssrc=${track.ssrc}`,
        );

        track.onReceiveRtp.subscribe((rtp) => {
          // Decode Opus RTP payload → PCM 16kHz → base64 → Gemini
          const pcmBase64 = this.audioCodec.decodeOpusToPcm16k(
            Buffer.from(rtp.payload),
          );
          if (pcmBase64) {
            const activeCall = this.activeCalls.get(callId);
            if (activeCall) {
              activeCall.geminiSession.sendAudio(pcmBase64);
            }
          }
        });
      });

      // 4. Set remote SDP offer from Meta
      await pc.setRemoteDescription({
        type: 'offer',
        sdp: sdpOffer,
      });

      // 5. Create answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // Wait for ICE gathering to complete
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
      this.logger.debug(`SDP answer:\n${sdpAnswer}`);

      // 6. Create Gemini Live session
      const geminiSession = this.geminiLive.createSession({
        onAudio: (pcmBase64: string, sampleRate: number) => {
          // Encode Gemini's PCM → Opus 48kHz → queue for paced RTP sending
          const activeCall = this.activeCalls.get(callId);
          if (!activeCall) return;

          // Stop silence frames once Gemini starts speaking
          if (!activeCall.geminiSpeaking) {
            activeCall.geminiSpeaking = true;
            this.stopSilenceFrames(activeCall);
            this.startRtpPacing(activeCall);
            this.logger.log(`[Call ${callId}] 🔊 Gemini started speaking (${sampleRate}Hz)`);
          }

          // Encode and queue frames (pacing interval will drain the queue)
          const opusFrames = this.audioCodec.encodePcmToOpus(pcmBase64, sampleRate);
          activeCall.rtpFrameQueue.push(...opusFrames);
        },
        onText: (text: string) => {
          this.logger.log(`[Call ${callId}] Gemini: "${text.slice(0, 80)}"`);
        },
        onTurnComplete: () => {
          this.logger.debug(`[Call ${callId}] Gemini turn complete`);
          const activeCall = this.activeCalls.get(callId);
          if (activeCall) {
            activeCall.geminiSpeaking = false;
            // Don't stop pacing yet — drain remaining frames in queue first
          }
        },
        onSetupComplete: () => {
          this.logger.log(`[Call ${callId}] ✅ Gemini ready — sending greeting`);
          geminiSession.sendGreeting();
        },
        onError: (error: string) => {
          this.logger.error(`[Call ${callId}] Gemini error: ${error}`);
        },
        onClose: () => {
          this.logger.log(`[Call ${callId}] Gemini session closed`);
        },
      });

      // 7. Store active call
      const activeCall: ActiveCall = {
        callId,
        phoneNumber,
        pc,
        geminiSession,
        transceiver,
        rtpFrameQueue: [],
        rtpSeq: Math.floor(Math.random() * 65535),
        rtpTimestamp: Math.floor(Math.random() * 0xFFFFFFFF),
        rtpSsrc: Math.floor(Math.random() * 0xFFFFFFFF),
        geminiSpeaking: false,
      };
      this.activeCalls.set(callId, activeCall);

      // 8. Pre-accept the call
      await this.sendCallAction(callId, 'pre_accept', sdpAnswer);
      this.logger.log(`[Call ${callId}] Pre-accepted`);

      // 9. Accept the call
      await this.sendCallAction(callId, 'accept', sdpAnswer);
      this.logger.log(`[Call ${callId}] Accepted ✅`);

      // 10. Start sending silence frames to keep connection alive
      this.startSilenceFrames(activeCall);
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
    this.stopSilenceFrames(call);
    this.stopRtpPacing(call);
    call.geminiSession.close();
    call.pc.close();
    this.activeCalls.delete(callId);

    this.logger.log(`[Call ${callId}] Cleaned up`);
  }

  // ── RTP Packet Construction ──────────────────────────────────────────────

  /**
   * Build and send a proper RTP packet through the transceiver sender.
   */
  private sendRtpPacket(call: ActiveCall, opusPayload: Buffer): void {
    try {
      const header = new RtpHeader({
        payloadType: OPUS_PAYLOAD_TYPE,
        sequenceNumber: call.rtpSeq & 0xFFFF,
        timestamp: call.rtpTimestamp & 0xFFFFFFFF,
        ssrc: call.rtpSsrc,
        marker: false,
      });

      const packet = new RtpPacket(header, opusPayload);

      // Send via transceiver sender
      call.transceiver.sender.sendRtp(packet).catch((err: any) => {
        this.logger.error(`[Call ${call.callId}] RTP send failed: ${err.message}`);
      });

      // Increment sequence number and timestamp
      call.rtpSeq = (call.rtpSeq + 1) & 0xFFFF;
      call.rtpTimestamp = (call.rtpTimestamp + OPUS_TIMESTAMP_INCREMENT) & 0xFFFFFFFF;
    } catch (err: any) {
      this.logger.error(`[Call ${call.callId}] RTP packet build failed: ${err.message}`);
    }
  }

  // ── Silence Frame Management ─────────────────────────────────────────────

  /**
   * Start sending silence Opus frames every 20ms to keep WhatsApp happy.
   * Stops when Gemini starts speaking or the call ends.
   */
  private startSilenceFrames(call: ActiveCall): void {
    const silenceFrame = this.audioCodec.getSilenceOpusFrame();
    this.logger.log(`[Call ${call.callId}] 🔇 Sending silence frames...`);

    call.silenceInterval = setInterval(() => {
      if (!call.geminiSpeaking) {
        this.sendRtpPacket(call, silenceFrame);
      }
    }, OPUS_FRAME_DURATION_MS);
  }

  /**
   * Stop the silence frame interval.
   */
  private stopSilenceFrames(call: ActiveCall): void {
    if (call.silenceInterval) {
      clearInterval(call.silenceInterval);
      call.silenceInterval = undefined;
      this.logger.debug(`[Call ${call.callId}] Silence frames stopped`);
    }
  }

  // ── RTP Pacing ───────────────────────────────────────────────────────────

  /**
   * Start draining the RTP frame queue at 20ms intervals.
   * This prevents burst-sending all frames at once (which causes crackling).
   */
  private startRtpPacing(call: ActiveCall): void {
    if (call.rtpPacingInterval) return; // Already running

    call.rtpPacingInterval = setInterval(() => {
      const frame = call.rtpFrameQueue.shift();
      if (frame) {
        this.sendRtpPacket(call, frame);
      } else if (!call.geminiSpeaking) {
        // Queue drained and Gemini turn is complete — go back to silence
        this.stopRtpPacing(call);
        this.startSilenceFrames(call);
      }
    }, OPUS_FRAME_DURATION_MS);
  }

  /**
   * Stop the RTP pacing interval.
   */
  private stopRtpPacing(call: ActiveCall): void {
    if (call.rtpPacingInterval) {
      clearInterval(call.rtpPacingInterval);
      call.rtpPacingInterval = undefined;
      call.rtpFrameQueue.length = 0;
    }
  }

  // ── Meta API ─────────────────────────────────────────────────────────────

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
