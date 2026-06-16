import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { MongoUserDetailsRepository } from '../src/whatsapp/user-details/mongo-user-details.repository';
import { UserDetailsModel } from '../src/whatsapp/user-details/user-details.schema';

describe('MongoUserDetailsRepository', () => {
  let repo: MongoUserDetailsRepository;
  let mockModel: any;

  beforeEach(async () => {
    mockModel = {
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MongoUserDetailsRepository,
        {
          provide: getModelToken(UserDetailsModel.name, 'USER_DETAILS_MONGO'),
          useValue: mockModel,
        },
      ],
    }).compile();

    repo = module.get(MongoUserDetailsRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getLastRephrasedQuery', () => {
    it('should return last_rephrased_query when found', async () => {
      const userId = '919940260567';
      const expectedQuery = 'Which mandi is offering the highest price for maize today?';

      mockModel.findOne.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({
              user_id: userId,
              last_rephrased_query: expectedQuery,
            }),
          }),
        }),
      });

      const result = await repo.getLastRephrasedQuery(userId);

      expect(result).toBe(expectedQuery);
      expect(mockModel.findOne).toHaveBeenCalledWith({ user_id: userId });
      expect(mockModel.findOne().select).toHaveBeenCalledWith('last_rephrased_query');
    });

    it('should return null when user not found', async () => {
      const userId = 'unknown_user';

      mockModel.findOne.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(null),
          }),
        }),
      });

      const result = await repo.getLastRephrasedQuery(userId);

      expect(result).toBeNull();
    });

    it('should return null when last_rephrased_query is null', async () => {
      const userId = '919940260567';

      mockModel.findOne.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({
              user_id: userId,
              last_rephrased_query: null,
            }),
          }),
        }),
      });

      const result = await repo.getLastRephrasedQuery(userId);

      expect(result).toBeNull();
    });

    it('should return null when database throws an error', async () => {
      const userId = '919940260567';

      mockModel.findOne.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockRejectedValue(new Error('Database connection failed')),
          }),
        }),
      });

      const result = await repo.getLastRephrasedQuery(userId);

      expect(result).toBeNull();
    });
  });
});