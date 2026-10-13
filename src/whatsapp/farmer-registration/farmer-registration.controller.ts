import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Logger,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FarmerRegistrationService, FlowCallbackData, FlowDataResponse } from './farmer-registration.service';
import { WhatsappService } from '../whatsapp-api/whatsapp.service';
import { LocationService } from '../location/location.service';
import { FlowEncryptionService } from '../flow-encryption/flow-encryption.service';

// ─────────────────────────────────────────────────────────────
// DTOs
// ─────────────────────────────────────────────────────────────

/**
 * Flow Callback Payload from WhatsApp Flow
 * Dropdowns return {id, title} objects in the data
 */
interface FlowCallbackPayload {
  phone_number: string;
  screen: string;
  action: string;  // 'GET_INITIAL_SCREEN' or 'FLOW_SUBMIT'
  data?: {
    state?: { id: string; title: string };
    district?: { id: string; title: string };
    block?: { id: string; title: string };
    village?: { id: string; title: string };
    state_code?: string;  // When navigating between screens
    district_code?: string;
    block_code?: string;
  };
}

interface FlowDataQuery {
  screen: string;
  stateCode?: string;
  districtCode?: string;
  blockCode?: string;
}

// ─────────────────────────────────────────────────────────────
// Controller
// ─────────────────────────────────────────────────────────────

@Controller('whatsapp/flows')
export class FarmerRegistrationController {
  private readonly logger = new Logger(FarmerRegistrationController.name);

  constructor(
    private readonly farmerRegistrationService: FarmerRegistrationService,
    private readonly whatsappService: WhatsappService,
    private readonly locationService: LocationService,
    private readonly flowEncryptionService: FlowEncryptionService,
  ) {}

  // ─────────────────────────────────────────────────────────────
  // Flow Data Endpoint (for dropdown options)
  // Called by Meta's Flow engine
  // ─────────────────────────────────────────────────────────────

  @Get('data')
  async getFlowData(@Query() query: FlowDataQuery): Promise<FlowDataResponse> {
    this.logger.debug(`Flow data request: screen=${query.screen}`);

    if (!query.screen) {
      throw new BadRequestException('screen parameter is required');
    }

    return this.farmerRegistrationService.getFlowData(query.screen, {
      stateCode: query.stateCode,
      districtCode: query.districtCode,
      blockCode: query.blockCode,
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Flow Callback Endpoint (on submission)
  // Receives WhatsApp Flow submission data
  // ─────────────────────────────────────────────────────────────

  @Get('callback')
  async handleFlowHealthCheck(): Promise<{ status: string }> {
    // Meta calls GET /callback to verify the endpoint is reachable
    return { status: 'ok' };
  }

  @Post('callback')
  @HttpCode(HttpStatus.OK)
  async handleFlowCallback(@Body() body: any): Promise<any> {
    this.logger.log(`Flow callback received`);

    try {
      // Check if the request is encrypted (Meta sends encrypted_flow_data)
      if (body.encrypted_flow_data) {
        return this.handleEncryptedCallback(body);
      }

      // Handle plain callback (for testing without encryption)
      const payload = body as FlowCallbackPayload;
      return this.handlePlainCallback(payload);

    } catch (error) {
      this.logger.error(`Flow callback error: ${error}`);
      return { status: 'error' };
    }
  }

  /**
   * Handle encrypted callback from Meta
   */
  private async handleEncryptedCallback(encryptedData: {
    encrypted_flow_data: string;
    encrypted_aes_key: string;
    initial_vector: string;
  }): Promise<any> {
    // Decrypt the request
    const decryptResult = this.flowEncryptionService.decryptFlowRequest(encryptedData);

    if (!decryptResult.success || !decryptResult.data) {
      this.logger.error(`Failed to decrypt: ${decryptResult.error}`);
      return { status: 'decryption_error', error: decryptResult.error };
    }

    const payload = decryptResult.data as FlowCallbackPayload;
    this.logger.log(`Decrypted - phone: ${payload.phone_number}, action: ${payload.action}, screen: ${payload.screen}`);

    // Handle the callback
    let responseData: any;

    if (payload.action === 'GET_INITIAL_SCREEN') {
      responseData = this.getScreenData(payload);
    } else if (payload.action === 'FLOW_SUBMIT') {
      const flowData: FlowCallbackData = {
        phone_number: payload.phone_number,
        state: payload.data?.state,
        district: payload.data?.district,
        block: payload.data?.block,
        village: payload.data?.village,
      };

      const result = await this.farmerRegistrationService.handleFlowCallback(flowData);

      if (result.isErr()) {
        this.logger.error(`Flow callback error: ${result.unwrapErr().message}`);
        responseData = { status: 'error' };
      } else {
        // Send welcome message
        await this.sendWelcomeMessage(payload.phone_number);
        this.logger.log(`Flow callback processed successfully for ${payload.phone_number}`);
        responseData = { status: 'success' };
      }
    } else {
      responseData = { status: 'unknown_action' };
    }

    // Encrypt the response
    const encryptResult = this.flowEncryptionService.encryptFlowResponse(responseData, encryptedData);

    if (!encryptResult.success) {
      this.logger.error(`Failed to encrypt response: ${encryptResult.error}`);
      // Return plain text error
      return encryptResult.error;
    }

    // Return base64 string directly (not wrapped in JSON)
    return encryptResult.encrypted_data;
  }

  /**
   * Handle plain (unencrypted) callback for testing
   */
  private async handlePlainCallback(payload: FlowCallbackPayload): Promise<any> {
    this.logger.log(`Plain callback - phone: ${payload.phone_number}, action: ${payload.action}, screen: ${payload.screen}`);

    // Handle GET_INITIAL_SCREEN - return dynamic data for screens
    if (payload.action === 'GET_INITIAL_SCREEN') {
      return this.getScreenData(payload);
    }

    // Handle FLOW_SUBMIT - process form submission
    if (payload.action === 'FLOW_SUBMIT') {
      const flowData: FlowCallbackData = {
        phone_number: payload.phone_number,
        state: payload.data?.state,
        district: payload.data?.district,
        block: payload.data?.block,
        village: payload.data?.village,
      };

      const result = await this.farmerRegistrationService.handleFlowCallback(flowData);

      if (result.isErr()) {
        this.logger.error(`Flow callback error: ${result.unwrapErr().message}`);
        return { status: 'error' };
      }

      // Send welcome message
      await this.sendWelcomeMessage(payload.phone_number);

      this.logger.log(`Flow callback processed successfully for ${payload.phone_number}`);
      return { status: 'success' };
    }

    return { status: 'unknown_action' };
  }

  /**
   * Get public key endpoint for Meta Business Manager
   */
  @Get('public-key')
  getPublicKey(): { public_key: string } {
    return {
      public_key: this.flowEncryptionService.getPublicKeyForMeta(),
    };
  }

  /**
   * Handle GET_INITIAL_SCREEN - return dynamic data for each screen
   */
  private async getScreenData(payload: FlowCallbackPayload): Promise<any> {
    const screen = payload.screen;
    const data = payload.data || {};

    this.logger.log(`Getting screen data for: ${screen}`);

    try {
      switch (screen) {
        case 'STATE_SCREEN': {
          const states = await this.locationService.getStatesFormatted();
          return {
            version: '3',
            screen: 'STATE_SCREEN',
            data: { states },
          };
        }

        case 'DISTRICT_SCREEN': {
          const stateCode = parseInt(data.state_code || data.state?.id || '0', 10);
          if (!stateCode) {
            return { error: 'State code required' };
          }
          const districts = await this.locationService.getDistrictsFormatted(stateCode);
          return {
            version: '3',
            screen: 'DISTRICT_SCREEN',
            data: { districts },
          };
        }

        case 'BLOCK_SCREEN': {
          const districtCode = parseInt(data.district_code || data.district?.id || '0', 10);
          if (!districtCode) {
            return { error: 'District code required' };
          }
          const blocks = await this.locationService.getBlocksFormatted(districtCode);
          return {
            version: '3',
            screen: 'BLOCK_SCREEN',
            data: { blocks },
          };
        }

        case 'VILLAGE_SCREEN': {
          const blockCode = parseInt(data.block_code || data.block?.id || '0', 10);
          if (!blockCode) {
            return { error: 'Block code required' };
          }
          const villages = await this.locationService.getVillagesFormatted(blockCode);
          return {
            version: '3',
            screen: 'VILLAGE_SCREEN',
            data: { villages },
          };
        }

        default:
          this.logger.warn(`Unknown screen: ${screen}`);
          return { error: 'Unknown screen' };
      }
    } catch (error) {
      this.logger.error(`Error getting screen data for ${screen}: ${error}`);
      return { error: String(error) };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Send Flow Link (to new users)
  // Called when a new user sends first message
  // ─────────────────────────────────────────────────────────────

  @Post('send-registration-link')
  async sendRegistrationLink(@Body() body: { phoneNumber: string }): Promise<{ status: string }> {
    this.logger.log(`Sending registration link to: ${body.phoneNumber}`);

    try {
      // This endpoint would be called internally when a new user sends first message
      // The actual implementation sends a template message with Flow link
      
      // For now, return success (actual flow link sending will be handled by message handler)
      return { status: 'success' };

    } catch (error) {
      this.logger.error(`Error sending registration link: ${error}`);
      return { status: 'error' };
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Check Registration Status
  // ─────────────────────────────────────────────────────────────

  @Get('status')
  async checkStatus(@Query('phoneNumber') phoneNumber: string): Promise<{
    needsRegistration: boolean;
    isRegistrationComplete: boolean;
    profile?: any;
  }> {
    if (!phoneNumber) {
      throw new BadRequestException('phoneNumber is required');
    }

    const result = await this.farmerRegistrationService.checkUserRegistrationStatus(phoneNumber);

    if (result.isErr()) {
      throw new BadRequestException(result.unwrapErr().message);
    }

    const status = result.unwrap();
    const profile = await this.farmerRegistrationService.getUserProfile(phoneNumber);

    return {
      needsRegistration: status.needsRegistration,
      isRegistrationComplete: status.isRegistrationComplete,
      profile,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────

  private async sendWelcomeMessage(phoneNumber: string): Promise<void> {
    const profile = await this.farmerRegistrationService.getUserProfile(phoneNumber);

    const locationText = profile
      ? `📍 Your Location:
• State: ${profile.stateName}
• District: ${profile.districtName}
• Block: ${profile.blockName}
• Village: ${profile.villageName}`
      : '';

    const message = `🎉 Registration Complete!

${locationText}

You can now ask me any farming questions! 🌾`;

    await this.whatsappService.sendTextMessage(phoneNumber, message);
  }
}