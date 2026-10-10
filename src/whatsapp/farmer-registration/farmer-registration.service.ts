import { Injectable, Logger } from '@nestjs/common';
import { Result, Ok, Err } from 'oxide.ts';
import { UserDetailsRepository } from '../user-details/user-details.repository';
import { LocationService } from '../location/location.service';
import { LocationProfile } from '../user-details/user-details.schema';
import { RepositoryError } from '../user-details/user-details.repository';
import { whatsappConfig } from '../whatsapp-api/whatsapp.config';
import { WhatsappService } from '../whatsapp-api/whatsapp.service';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

/**
 * WhatsApp Flow callback data structure
 * Matches the Flow JSON where dropdowns return {id, title} objects
 */
export interface FlowCallbackData {
  phone_number: string;
  state: { id: string; title: string };
  district: { id: string; title: string };
  block: { id: string; title: string };
  village: { id: string; title: string };
}

export interface FlowOption {
  id: string;
  title: string;
}

export interface FlowDataResponse {
  data: {
    states?: FlowOption[];
    districts?: FlowOption[];
    blocks?: FlowOption[];
    villages?: FlowOption[];
  };
}

export interface FlowExecutePayload {
  screen: string;
  data: {
    states?: FlowOption[];
    districts?: FlowOption[];
    blocks?: FlowOption[];
    villages?: FlowOption[];
  };
}

// ─────────────────────────────────────────────────────────────
// Farmer Registration Service
// ─────────────────────────────────────────────────────────────

@Injectable()
export class FarmerRegistrationService {
  private readonly logger = new Logger(FarmerRegistrationService.name);

  constructor(
    private readonly userDetailsRepository: UserDetailsRepository,
    private readonly locationService: LocationService,
    private readonly whatsappService: WhatsappService,
  ) {}

  // ─────────────────────────────────────────────────────────────
  // Public API Methods
  // ─────────────────────────────────────────────────────────────

  /**
   * Get location data for WhatsApp Flow dropdowns
   * Returns data in {id, title} format matching Flow JSON
   */
  async getFlowData(screen: string, params: { stateCode?: string; districtCode?: string; blockCode?: string }): Promise<FlowDataResponse> {
    this.logger.debug(`Getting flow data for screen: ${screen}`);

    switch (screen) {
      case 'STATE_SCREEN': {
        const states = await this.locationService.getStatesFormatted();
        return { data: { states } };
      }

      case 'DISTRICT_SCREEN': {
        if (!params.stateCode) {
          return { data: {} };
        }
        const districts = await this.locationService.getDistrictsFormatted(parseInt(params.stateCode));
        return { data: { districts } };
      }

      case 'BLOCK_SCREEN': {
        if (!params.districtCode) {
          return { data: {} };
        }
        const blocks = await this.locationService.getBlocksFormatted(parseInt(params.districtCode));
        return { data: { blocks } };
      }

      case 'VILLAGE_SCREEN': {
        if (!params.blockCode) {
          return { data: {} };
        }
        const villages = await this.locationService.getVillagesFormatted(parseInt(params.blockCode));
        return { data: { villages } };
      }

      default:
        this.logger.warn(`Unknown screen: ${screen}`);
        return { data: {} };
    }
  }

  /**
   * Send WhatsApp Flow to a user with initial states data
   */
  async sendRegistrationFlow(userId: string): Promise<Result<void, RepositoryError>> {
    this.logger.log(`Sending registration flow to ${userId}`);

    try {
      // Get states for initial dropdown
      const states = await this.locationService.getStatesFormatted();

      if (states.length === 0) {
        this.logger.error('No states available for flow');
        return Err(new RepositoryError('No states available', 'INVALID_CONFIG' as any));
      }

      // Build flow payload
      const payload: FlowExecutePayload = {
        screen: 'STATE_SCREEN',
        data: { states },
      };

      // Send flow via WhatsApp API
      await this.whatsappService.sendFlowMessage(userId, payload);

      this.logger.log(`Registration flow sent to ${userId}`);
      return Ok(undefined);

    } catch (error) {
      this.logger.error(`Failed to send registration flow: ${error}`);
      return Err(
        new RepositoryError(
          String(error),
          'FLOW_SEND_FAILED' as any,
          error,
        ),
      );
    }
  }

  /**
   * Handle WhatsApp Flow callback (submission)
   * Flow JSON sends dropdown data as {id, title} objects
   */
  async handleFlowCallback(data: FlowCallbackData): Promise<Result<void, RepositoryError>> {
    this.logger.log(`Processing flow callback for phone: ${data.phone_number}`);

    try {
      const phoneNumber = this.normalizePhoneNumber(data.phone_number);

      // Build location profile from Flow callback data
      // Flow sends {id, title} objects from dropdown selections
      const profile: LocationProfile = {
        stateCode: parseInt(data.state.id),
        stateName: data.state.title,
        districtCode: parseInt(data.district.id),
        districtName: data.district.title,
        blockCode: parseInt(data.block.id),
        blockName: data.block.title,
        villageCode: parseInt(data.village.id),
        villageName: data.village.title,
      };

      // Check if user exists
      const userStatusResult = await this.userDetailsRepository.checkUserStatus(phoneNumber);

      if (userStatusResult.isErr()) {
        return Err(userStatusResult.unwrapErr());
      }

      const userStatus = userStatusResult.unwrap();

      // Create user if doesn't exist
      if (!userStatus.exists) {
        const createResult = await this.userDetailsRepository.createUser(phoneNumber);
        if (createResult.isErr()) {
          return Err(createResult.unwrapErr());
        }
      }

      // Update profile
      const updateResult = await this.userDetailsRepository.updateLocationProfile(phoneNumber, profile);
      if (updateResult.isErr()) {
        return Err(updateResult.unwrapErr());
      }

      // Complete registration
      const completeResult = await this.userDetailsRepository.completeRegistration(phoneNumber);
      if (completeResult.isErr()) {
        return Err(completeResult.unwrapErr());
      }

      this.logger.log(`Registration completed for ${phoneNumber}`);
      return Ok(undefined);

    } catch (error) {
      this.logger.error(`Error processing flow callback: ${error}`);
      return Err(
        new RepositoryError(
          String(error),
          'UNKNOWN' as any,
          error,
        ),
      );
    }
  }

  /**
   * Check if user needs registration
   */
  async checkUserRegistrationStatus(
    phoneNumber: string,
  ): Promise<Result<{ needsRegistration: boolean; isRegistrationComplete: boolean }, RepositoryError>> {
    const normalized = this.normalizePhoneNumber(phoneNumber);
    const result = await this.userDetailsRepository.checkUserStatus(normalized);

    if (result.isErr()) {
      return Err(result.unwrapErr());
    }

    const status = result.unwrap();

    return Ok({
      needsRegistration: !status.exists || !status.profile?.isProfileComplete,
      isRegistrationComplete: status.profile?.isProfileComplete ?? false,
    });
  }

  /**
   * Get user profile
   */
  async getUserProfile(phoneNumber: string) {
    const normalized = this.normalizePhoneNumber(phoneNumber);
    const result = await this.userDetailsRepository.getProfile(normalized);

    if (result.isErr()) {
      return null;
    }

    return result.unwrap();
  }

  // ─────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────

  private normalizePhoneNumber(phoneNumber: string): string {
    const cleaned = phoneNumber.replace(/[\s\-\(\)]/g, '');

    if (cleaned.startsWith('+')) {
      return cleaned;
    }

    // Assume Indian numbers (country code 91)
    if (cleaned.length === 10) {
      return `+91${cleaned}`;
    }

    return `+${cleaned}`;
  }
}