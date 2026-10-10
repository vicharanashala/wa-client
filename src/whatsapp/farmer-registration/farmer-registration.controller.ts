import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { FarmerRegistrationService, FlowCallbackData, FlowDataResponse } from './farmer-registration.service';
import { WhatsappService } from '../whatsapp-api/whatsapp.service';

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
  data: {
    state: { id: string; title: string };
    district: { id: string; title: string };
    block: { id: string; title: string };
    village: { id: string; title: string };
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

  @Post('callback')
  async handleFlowCallback(@Body() payload: FlowCallbackPayload): Promise<{ status: string }> {
    this.logger.log(`Flow callback received for phone: ${payload.phone_number}`);

    try {
      // Extract data from Flow submission
      // Flow sends {id, title} objects from dropdown selections
      const flowData: FlowCallbackData = {
        phone_number: payload.phone_number,
        state: payload.data.state,
        district: payload.data.district,
        block: payload.data.block,
        village: payload.data.village,
      };

      // Process the callback
      const result = await this.farmerRegistrationService.handleFlowCallback(flowData);

      if (result.isErr()) {
        this.logger.error(`Flow callback error: ${result.unwrapErr().message}`);
        return { status: 'error' };
      }

      // Send welcome message
      await this.sendWelcomeMessage(payload.phone_number);

      this.logger.log(`Flow callback processed successfully for ${payload.phone_number}`);
      return { status: 'success' };

    } catch (error) {
      this.logger.error(`Flow callback error: ${error}`);
      return { status: 'error' };
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