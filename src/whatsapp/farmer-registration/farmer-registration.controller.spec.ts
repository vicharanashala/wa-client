import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { FarmerRegistrationController } from './farmer-registration.controller';
import { FarmerRegistrationService } from './farmer-registration.service';
import { FlowSubmissionRepository } from './flow-submission.repository';
import { LocationService } from '../location/location.service';
import { FlowEncryptionService } from '../flow-encryption/flow-encryption.service';
import { WhatsappService } from '../whatsapp-api/whatsapp.service';
import { Result, Ok, Err } from 'oxide.ts';
import { RepositoryError } from '../user-details/user-details.repository';

// Mock services
const mockFarmerRegistrationService = {
  processSimplifiedFlowComplete: jest.fn(),
  getFlowData: jest.fn(),
};

const mockFlowSubmissionRepository = {
  createSubmission: jest.fn(),
};

const mockLocationService = {
  getStatesFormatted: jest.fn(),
  getDistrictsFormatted: jest.fn(),
  getBlocksFormatted: jest.fn(),
  getVillagesFormatted: jest.fn(),
};

const mockFlowEncryptionService = {
  decryptFlowRequest: jest.fn(),
  encryptFlowResponse: jest.fn(),
};

const mockWhatsappService = {
  sendTextMessage: jest.fn(),
};

// Test data
const sampleEncryptedRequest = {
  encrypted_flow_data: 'base64_encrypted_data',
  encrypted_aes_key: 'base64_aes_key',
  initial_vector: 'base64_iv',
};

const sampleStates = [
  { id: '9', title: 'Rajasthan' },
  { id: '10', title: 'Maharashtra' },
];

const sampleDistricts = [
  { id: '91', title: 'Jaipur' },
  { id: '92', title: 'Jodhpur' },
];

const sampleBlocks = [
  { id: '911', title: 'Chaksu' },
  { id: '912', title: 'Phagi' },
];

const sampleVillages = [
  { id: '9111', title: 'Village 1' },
  { id: '9112', title: 'Village 2' },
];

describe('FarmerRegistrationController', () => {
  let controller: FarmerRegistrationController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FarmerRegistrationController],
      providers: [
        {
          provide: FarmerRegistrationService,
          useValue: mockFarmerRegistrationService,
        },
        {
          provide: FlowSubmissionRepository,
          useValue: mockFlowSubmissionRepository,
        },
        {
          provide: LocationService,
          useValue: mockLocationService,
        },
        {
          provide: FlowEncryptionService,
          useValue: mockFlowEncryptionService,
        },
        {
          provide: WhatsappService,
          useValue: mockWhatsappService,
        },
      ],
    }).compile();

    controller = module.get<FarmerRegistrationController>(FarmerRegistrationController);
    
    // Reset mocks
    jest.clearAllMocks();
  });

  describe('POST /whatsapp/flow/callback - ping action', () => {
    it('should return active status for ping action', async () => {
      const result = await controller.handleFlowCallback({ action: 'ping' });
      expect(result).toEqual({ data: { status: 'active' } });
    });
  });

  describe('POST /whatsapp/flow/callback - complete action', () => {
    it('should save flow submission and return success', async () => {
      // Setup mock
      mockFarmerRegistrationService.processSimplifiedFlowComplete.mockResolvedValue(
        Ok({
          stateCode: '9',
          districtCode: 'va',
          blockCode: 'vs',
          villageCode: 'rj',
          submittedAt: new Date(),
        }),
      );

      // Call endpoint
      const result = await controller.handleFlowCallback({
        action: 'complete',
        data: {
          state: '9',
          district: 'va',
          block: 'vs',
          village: 'rj',
        },
        flow_token: 'test-token',
      });

      // Verify
      expect(result).toEqual({
        data: {
          status: 'success',
          message: 'Profile updated successfully',
        },
      });
      expect(mockFarmerRegistrationService.processSimplifiedFlowComplete).toHaveBeenCalledWith({
        state: '9',
        district: 'va',
        block: 'vs',
        village: 'rj',
      });
    });

    it('should return error when required fields are missing', async () => {
      mockFarmerRegistrationService.processSimplifiedFlowComplete.mockResolvedValue(
        Err(new RepositoryError('Missing required fields', 'INVALID_DATA' as any)),
      );

      const result = await controller.handleFlowCallback({
        action: 'complete',
        data: {
          state: '9',
          // missing district, block, village
        },
      });

      expect(result).toEqual({
        data: {
          status: 'error',
          message: 'Missing required fields (state, district, block, village)',
        },
      });
    });
  });

  // ─────────────────────────────────────────────────────────────
  // POST /whatsapp/flow/data (Encrypted) Tests
  // ─────────────────────────────────────────────────────────────

  describe('POST /whatsapp/flow/data - Encrypted Flow Data', () => {
    describe('STATE_SCREEN', () => {
      it('should return states for STATE_SCREEN', async () => {
        mockFlowEncryptionService.decryptFlowRequest.mockReturnValue({
          success: true,
          data: { action: 'GET_DATA', screen: 'STATE_SCREEN', data: {} },
        });
        mockFlowEncryptionService.encryptFlowResponse.mockReturnValue({
          success: true,
          encrypted_data: 'encrypted_response_base64',
        });
        mockLocationService.getStatesFormatted.mockResolvedValue(sampleStates);

        const result = await controller.getFlowDataEncrypted(sampleEncryptedRequest);

        expect(result).toBe('encrypted_response_base64');
        expect(mockLocationService.getStatesFormatted).toHaveBeenCalled();
        expect(mockFlowEncryptionService.encryptFlowResponse).toHaveBeenCalledWith(
          { screen: 'STATE_SCREEN', data: { states: sampleStates } },
          sampleEncryptedRequest,
        );
      });
    });

    describe('DISTRICT_SCREEN', () => {
      it('should return districts for a given state', async () => {
        mockFlowEncryptionService.decryptFlowRequest.mockReturnValue({
          success: true,
          data: { action: 'GET_DATA', screen: 'DISTRICT_SCREEN', data: { state_code: '9' } },
        });
        mockFlowEncryptionService.encryptFlowResponse.mockReturnValue({
          success: true,
          encrypted_data: 'encrypted_response_base64',
        });
        mockLocationService.getDistrictsFormatted.mockResolvedValue(sampleDistricts);

        const result = await controller.getFlowDataEncrypted(sampleEncryptedRequest);

        expect(result).toBe('encrypted_response_base64');
        expect(mockLocationService.getDistrictsFormatted).toHaveBeenCalledWith(9);
      });

      it('should return empty districts when state_code is missing', async () => {
        mockFlowEncryptionService.decryptFlowRequest.mockReturnValue({
          success: true,
          data: { action: 'GET_DATA', screen: 'DISTRICT_SCREEN', data: {} },
        });
        mockFlowEncryptionService.encryptFlowResponse.mockReturnValue({
          success: true,
          encrypted_data: 'encrypted_response_base64',
        });

        await controller.getFlowDataEncrypted(sampleEncryptedRequest);

        expect(mockLocationService.getDistrictsFormatted).not.toHaveBeenCalled();
      });
    });

    describe('BLOCK_SCREEN', () => {
      it('should return blocks for a given district', async () => {
        mockFlowEncryptionService.decryptFlowRequest.mockReturnValue({
          success: true,
          data: { action: 'GET_DATA', screen: 'BLOCK_SCREEN', data: { district_code: '91' } },
        });
        mockFlowEncryptionService.encryptFlowResponse.mockReturnValue({
          success: true,
          encrypted_data: 'encrypted_response_base64',
        });
        mockLocationService.getBlocksFormatted.mockResolvedValue(sampleBlocks);

        const result = await controller.getFlowDataEncrypted(sampleEncryptedRequest);

        expect(result).toBe('encrypted_response_base64');
        expect(mockLocationService.getBlocksFormatted).toHaveBeenCalledWith(91);
      });
    });

    describe('VILLAGE_SCREEN', () => {
      it('should return villages for a given block', async () => {
        mockFlowEncryptionService.decryptFlowRequest.mockReturnValue({
          success: true,
          data: { action: 'GET_DATA', screen: 'VILLAGE_SCREEN', data: { block_code: '911' } },
        });
        mockFlowEncryptionService.encryptFlowResponse.mockReturnValue({
          success: true,
          encrypted_data: 'encrypted_response_base64',
        });
        mockLocationService.getVillagesFormatted.mockResolvedValue(sampleVillages);

        const result = await controller.getFlowDataEncrypted(sampleEncryptedRequest);

        expect(result).toBe('encrypted_response_base64');
        expect(mockLocationService.getVillagesFormatted).toHaveBeenCalledWith(911);
      });
    });

    describe('Error handling', () => {
      it('should throw BadRequestException when decryption fails', async () => {
        mockFlowEncryptionService.decryptFlowRequest.mockReturnValue({
          success: false,
          error: 'Decryption failed',
        });

        await expect(controller.getFlowDataEncrypted(sampleEncryptedRequest))
          .rejects.toThrow(BadRequestException);
      });

      it('should throw InternalServerErrorException when encryption fails', async () => {
        mockFlowEncryptionService.decryptFlowRequest.mockReturnValue({
          success: true,
          data: { action: 'GET_DATA', screen: 'STATE_SCREEN', data: {} },
        });
        mockLocationService.getStatesFormatted.mockResolvedValue(sampleStates);
        mockFlowEncryptionService.encryptFlowResponse.mockReturnValue({
          success: false,
          error: 'Encryption failed',
        });

        await expect(controller.getFlowDataEncrypted(sampleEncryptedRequest))
          .rejects.toThrow(InternalServerErrorException);
      });

      it('should handle unknown screens gracefully', async () => {
        mockFlowEncryptionService.decryptFlowRequest.mockReturnValue({
          success: true,
          data: { action: 'GET_DATA', screen: 'UNKNOWN_SCREEN', data: {} },
        });
        mockFlowEncryptionService.encryptFlowResponse.mockReturnValue({
          success: true,
          encrypted_data: 'encrypted_response_base64',
        });

        const result = await controller.getFlowDataEncrypted(sampleEncryptedRequest);

        expect(result).toBe('encrypted_response_base64');
        expect(mockLocationService.getStatesFormatted).not.toHaveBeenCalled();
      });
    });
  });
});