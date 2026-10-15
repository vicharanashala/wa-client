import { Test, TestingModule } from '@nestjs/testing';
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
};

const mockWhatsappService = {
  sendTextMessage: jest.fn(),
};

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

  describe('POST /whatsapp/flows/callback - ping action', () => {
    it('should return active status for ping action', async () => {
      const result = await controller.handleFlowCallback({ action: 'ping' });
      expect(result).toEqual({ data: { status: 'active' } });
    });
  });

  describe('POST /whatsapp/flows/callback - complete action', () => {
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
});