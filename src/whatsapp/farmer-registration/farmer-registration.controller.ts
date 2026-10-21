import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Req,
  Logger,
  BadRequestException,
  InternalServerErrorException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FarmerRegistrationService, FlowCallbackData, FlowDataResponse, SimplifiedFlowData } from './farmer-registration.service';
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

/**
 * WhatsApp Flow Complete Payload (simplified format)
 * When user clicks "Complete Profile", Meta sends:
 * {
 *   "version": "3",
 *   "action": "complete",
 *   "data": { "state": "9", "district": "va", "block": "vs", "village": "rj" },
 *   "flow_token": "..."
 * }
 */
interface FlowCompletePayload {
  version?: string;
  action: string;
  data: SimplifiedFlowData;
  flow_token?: string;
}

/**
 * Ping Payload
 */
interface FlowPingPayload {
  action: string;
}

interface FlowDataQuery {
  screen: string;
  stateCode?: string;
  districtCode?: string;
  blockCode?: string;
}

/**
 * Encrypted Flow Data Request from WhatsApp
 * WhatsApp Flow 3.0 sends encrypted payloads via POST
 */
interface EncryptedFlowDataRequest {
  encrypted_flow_data: string;
  encrypted_aes_key: string;
  initial_vector: string;
}

/**
 * Decrypted Flow Data Request Body
 * After decryption, the payload contains:
 * {
 *   "action": "GET_DATA",
 *   "screen": "STATE_SCREEN" | "DISTRICT_SCREEN" | "BLOCK_SCREEN" | "VILLAGE_SCREEN",
 *   "data": {
 *     "state_code"?: string,   // For DISTRICT_SCREEN
 *     "district_code"?: string, // For BLOCK_SCREEN
 *     "block_code"?: string     // For VILLAGE_SCREEN
 *   }
 * }
 */
interface DecryptedFlowDataRequest {
  action: string;
  screen: string;
  data?: {
    state_code?: string;
    district_code?: string;
    block_code?: string;
  };
}

/**
 * WhatsApp Flow Response format
 */
interface FlowCompleteResponse {
  data: {
    status: string;
    message?: string;
  };
}

/**
 * Flow Data Screen Response (matches Flow JSON structure)
 */
interface FlowDataScreenResponse {
  screen: string;
  data: {
    states?: Array<{ id: string; title: string }>;
    districts?: Array<{ id: string; title: string }>;
    blocks?: Array<{ id: string; title: string }>;
    villages?: Array<{ id: string; title: string }>;
  };
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
  // Encrypted Flow Data Endpoint (WhatsApp Flow 3.0)
  // Called by Meta's Flow engine with encrypted payload
  // ─────────────────────────────────────────────────────────────

  /**
   * POST /whatsapp/flows/data (Encrypted)
   * 
   * WhatsApp Flow 3.0 sends an encrypted POST request with:
   * - encrypted_flow_data: Base64 encoded encrypted JSON payload
   * - encrypted_aes_key: Base64 encoded RSA-encrypted AES key
   * - initial_vector: Base64 encoded 16-byte IV
   * 
   * We decrypt, process, and return an encrypted response.
   */
  @Post('data')
  @HttpCode(HttpStatus.OK)
  async getFlowDataEncrypted(
    @Body() encryptedRequest: EncryptedFlowDataRequest,
  ): Promise<string> {
    this.logger.log(`[WhatsApp Flow] Received encrypted data request`);
    this.logger.log(`[WhatsApp Flow] Raw payload: ${JSON.stringify(encryptedRequest)}`);
    this.logger.log(`[WhatsApp Flow] Missing encrypted_flow_data: ${!encryptedRequest.encrypted_flow_data}`);
    this.logger.log(`[WhatsApp Flow] Missing encrypted_aes_key: ${!encryptedRequest.encrypted_aes_key}`);
    this.logger.log(`[WhatsApp Flow] Missing initial_vector: ${!encryptedRequest.initial_vector}`);
    this.logger.log(`[WhatsApp Flow] Encrypted payload keys: ${Object.keys(encryptedRequest).join(', ')}`);
    this.logger.log(`[WhatsApp Flow] encrypted_flow_data length: ${encryptedRequest.encrypted_flow_data?.length || 0}`);
    this.logger.log(`[WhatsApp Flow] encrypted_aes_key length: ${encryptedRequest.encrypted_aes_key?.length || 0}`);
    this.logger.log(`[WhatsApp Flow] initial_vector length: ${encryptedRequest.initial_vector?.length || 0}`);

    // Step 1: Decrypt the incoming request
    const decryptResult = this.flowEncryptionService.decryptFlowRequest(encryptedRequest);

    if (!decryptResult.success) {
      this.logger.error(`[WhatsApp Flow] Failed to decrypt flow request: ${decryptResult.error}`);
      throw new BadRequestException('Failed to decrypt request');
    }

    const requestData = decryptResult.data as DecryptedFlowDataRequest;
    this.logger.log(`[WhatsApp Flow] Decrypted request: ${JSON.stringify(requestData)}`);

    // Step 2: Process the request and get response data
    const responseData = await this.processFlowDataRequest(requestData);

    this.logger.log(`[WhatsApp Flow] API Response for ${requestData.screen}: ${JSON.stringify(responseData)}`);

    // Step 3: Encrypt and return the response
    const encryptResult = this.flowEncryptionService.encryptFlowResponse(
      responseData,
      encryptedRequest,
    );

    if (!encryptResult.success) {
      this.logger.error(`[WhatsApp Flow] Failed to encrypt flow response: ${encryptResult.error}`);
      throw new InternalServerErrorException('Failed to encrypt response');
    }

    this.logger.log(`[WhatsApp Flow] Encrypted response sent successfully for ${requestData.screen}`);
    return encryptResult.encrypted_data as string;
  }

  /**
   * Process the decrypted flow data request and return response data
   */
  private async processFlowDataRequest(request: DecryptedFlowDataRequest): Promise<FlowDataScreenResponse> {
    const { screen } = request;
    const { state_code, district_code, block_code } = request.data || {};

    try {
      switch (screen) {
        case 'STATE_SCREEN': {
          const states = await this.locationService.getStatesFormatted();
          return {
            screen: 'STATE_SCREEN',
            data: { states },
          };
        }

        case 'DISTRICT_SCREEN': {
          if (!state_code) {
            return { screen: 'DISTRICT_SCREEN', data: { districts: [] } };
          }
          const stateCodeNum = parseInt(state_code, 10);
          const districts = await this.locationService.getDistrictsFormatted(stateCodeNum);
          return {
            screen: 'DISTRICT_SCREEN',
            data: { districts },
          };
        }

        case 'BLOCK_SCREEN': {
          if (!district_code) {
            return { screen: 'BLOCK_SCREEN', data: { blocks: [] } };
          }
          const districtCodeNum = parseInt(district_code, 10);
          const blocks = await this.locationService.getBlocksFormatted(districtCodeNum);
          return {
            screen: 'BLOCK_SCREEN',
            data: { blocks },
          };
        }

        case 'VILLAGE_SCREEN': {
          if (!block_code) {
            return { screen: 'VILLAGE_SCREEN', data: { villages: [] } };
          }
          const blockCodeNum = parseInt(block_code, 10);
          const villages = await this.locationService.getVillagesFormatted(blockCodeNum);
          return {
            screen: 'VILLAGE_SCREEN',
            data: { villages },
          };
        }

        default:
          this.logger.warn(`Unknown screen in encrypted request: ${screen}`);
          return {
            screen: screen || 'UNKNOWN_SCREEN',
            data: {},
          };
      }
    } catch (error) {
      this.logger.error(`Error processing flow data request for ${screen}: ${error}`);
      return {
        screen,
        data: {},
      };
    }
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
  async handleFlowCallback(
    @Body() body: any,
    @Req() req: any,
  ): Promise<any> {
    // DETAILED HTTP REQUEST LOGGING
    this.logger.warn(`[HTTP DEBUG] ========== INCOMING WHATSAPP FLOW REQUEST ==========`);
    this.logger.warn(`[HTTP DEBUG] Method: ${req.method}`);
    this.logger.warn(`[HTTP DEBUG] URL: ${req.url}`);
    this.logger.warn(`[HTTP DEBUG] Headers: ${JSON.stringify({
      'content-type': req.headers['content-type'],
      'user-agent': req.headers['user-agent'],
      'x-hub-signature': req.headers['x-hub-signature'] ? 'present' : 'missing',
    })}`);
    this.logger.warn(`[HTTP DEBUG] Raw Body Keys: ${Object.keys(body).join(', ')}`);
    this.logger.warn(`[HTTP DEBUG] Full Body: ${JSON.stringify(body)}`);
    this.logger.warn(`[HTTP DEBUG] action field: "${body.action}"`);
    this.logger.warn(`[HTTP DEBUG] screen field: "${body.screen}"`);
    this.logger.warn(`[HTTP DEBUG] ======================================================`);

    try {
      // Handle init action - Meta sends this first to get initial screen
      if (body.action === 'init') {
        this.logger.log('[WhatsApp Flow] Handling init request - returning STATE_SCREEN');
        const states = await this.locationService.getStatesFormatted();
        return {
          screen: 'STATE_SCREEN',
          data: { states },
        };
      }

      // Handle ping action for health checks
      if (body.action === 'ping') {
        this.logger.debug('Handling ping request');
        return {
          screen: body.screen,
          data: { status: 'active' },
        };
      }

      // Handle action=complete (new simplified format from Flow)
      if (body.action === 'complete') {
        return this.handleFlowComplete(body as FlowCompletePayload);
      }

      // Handle encrypted callback (Meta sends encrypted_flow_data)
      if (body.encrypted_flow_data) {
        return this.handleEncryptedCallback(body);
      }

      // Handle plain callback (old format with screen/action fields)
      const payload = body as FlowCallbackPayload;
      return this.handlePlainCallback(payload);

    } catch (error) {
      this.logger.error(`Flow callback error: ${error}`);
      return { data: { status: 'error', message: String(error) } };
    }
  }

  /**
   * Handle Flow Complete action
   * This is called when user clicks "Complete Profile" in the WhatsApp Flow
   * The payload format is: { action: 'complete', data: { state: '9', district: 'va', ... } }
   */
  private async handleFlowComplete(payload: FlowCompletePayload): Promise<FlowCompleteResponse> {
    this.logger.log(`Handling Flow complete. flow_token=${payload.flow_token}`);

    try {
      const data = payload.data;

      // Validate required fields
      if (!data.state || !data.district || !data.block || !data.village) {
        this.logger.warn('Missing required fields in flow complete');
        return {
          data: {
            status: 'error',
            message: 'Missing required fields (state, district, block, village)',
          },
        };
      }

      // Process the simplified flow data
      const result = await this.farmerRegistrationService.processSimplifiedFlowComplete(data);

      if (result.isErr()) {
        this.logger.error(`Error processing flow complete: ${result.unwrapErr().message}`);
        return {
          data: {
            status: 'error',
            message: result.unwrapErr().message,
          },
        };
      }

      this.logger.log(`Flow complete processed successfully for state=${data.state}, district=${data.district}`);

      // Return success response in WhatsApp Flow format
      return {
        data: {
          status: 'success',
          message: 'Profile updated successfully',
        },
      };

    } catch (error) {
      this.logger.error(`Error in handleFlowComplete: ${error}`);
      return {
        data: {
          status: 'error',
          message: String(error),
        },
      };
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
    // TEMP: Log ALL actions to debug what Preview sends
    this.logger.log(`[FLOW DEBUG] Raw action: "${payload.action}", full payload: ${JSON.stringify(payload)}`);
    this.logger.debug(`Decrypted - phone: ${payload.phone_number}, action: ${payload.action}, screen: ${payload.screen}`);

    // Handle the callback
    let responseData: any;

    if (payload.action === 'GET_INITIAL_SCREEN') {
      responseData = this.getScreenData(payload);
    } else if (payload.action === 'ping') {
      // Meta health check
      responseData = { 
        screen: payload.screen,
        data: { status: 'active' } 
      };
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
        responseData = {
          screen: payload.screen,
          data: { error_message: result.unwrapErr().message },
        };
      } else {
        // Send welcome message
        await this.sendWelcomeMessage(payload.phone_number);
        this.logger.log(`Flow callback processed successfully for ${payload.phone_number}`);
        // Return SUCCESS screen to close the flow
        responseData = {
          screen: 'SUCCESS',
          data: {
            extension_message_response: {
              params: {
                flow_token: payload.phone_number, // Using phone as flow_token if not provided
              },
            },
          },
        };
      }
    } else {
      // TEMP: Log the unhandled action for debugging
      this.logger.warn(`[FLOW DEBUG] Unknown action received: "${payload.action}"`);
      responseData = { 
        screen: payload.screen,
        data: { status: 'unknown_action', error_message: `Unknown action: ${payload.action}` }
      };
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
    // TEMP: Log ALL actions to debug what Preview sends
    this.logger.log(`[FLOW DEBUG] Plain callback - action: "${payload.action}", full payload: ${JSON.stringify(payload)}`);
    this.logger.log(`Plain callback - phone: ${payload.phone_number}, action: ${payload.action}, screen: ${payload.screen}`);

    // Handle init action - Meta sends this first to get initial screen
    if (payload.action === 'init') {
      this.logger.log('[WhatsApp Flow] Plain callback - Handling init request - returning STATE_SCREEN');
      const states = await this.locationService.getStatesFormatted();
      return {
        screen: 'STATE_SCREEN',
        data: { states },
      };
    }

    // Handle GET_INITIAL_SCREEN - return dynamic data for screens
    if (payload.action === 'GET_INITIAL_SCREEN') {
      return this.getScreenData(payload);
    }

    // Handle ping - Meta health check
    if (payload.action === 'ping') {
      return { 
        screen: payload.screen,
        data: { status: 'active' } 
      };
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
        return { 
          screen: payload.screen,
          data: { error_message: result.unwrapErr().message } 
        };
      }

      // Send welcome message
      await this.sendWelcomeMessage(payload.phone_number);

      this.logger.log(`Flow callback processed successfully for ${payload.phone_number}`);
      return { 
        screen: payload.screen,
        data: { status: 'success', extension_message_response: { params: { flow_token: payload.phone_number } } }
      };
    }

    // TEMP: Log unhandled action
    this.logger.warn(`[FLOW DEBUG] Unknown action in plain callback: "${payload.action}"`);
    return { 
      screen: payload.screen,
      data: { status: 'unknown_action', error_message: `Unknown action: ${payload.action}` }
    };
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