import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  PendingQuestionDocument,
  PendingQuestionModel,
} from './pending-question.schema';
import {
  CreatePendingQuestionDto,
  PendingQuestionRepository,
} from './pending-question.repository';

@Injectable()
export class MongoPendingQuestionRepository
  implements PendingQuestionRepository
{
  constructor(
    @InjectModel(PendingQuestionModel.name)
    private readonly model: Model<PendingQuestionDocument>,
  ) {}

  async create(dto: CreatePendingQuestionDto): Promise<void> {
    await this.model.create({
      questionId: dto.questionId,
      phoneNumber: dto.phoneNumber,
      queryText: dto.queryText,
      toolCallId: dto.toolCallId,
      ...(dto.originalMessageId
        ? { originalMessageId: dto.originalMessageId }
        : {}),
      status: 'pending',
    });
  }

  async findAllPending(): Promise<PendingQuestionModel[]> {
    return this.model
      .find({ status: 'pending' })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
  }

  async findByQuestionId(questionId: string): Promise<PendingQuestionModel | null> {
    return this.model.findOne({ questionId }).lean().exec();
  }

  async markAnswered(questionId: string, answer: string): Promise<void> {
    await this.model
      .updateOne(
        { questionId, status: 'pending' },
        { $set: { status: 'answered', answer, answeredAt: new Date() } },
      )
      .exec();
  }

  async markNotified(questionId: string): Promise<void> {
    await this.model
      .updateOne(
        { questionId, status: 'answered' },
        { $set: { status: 'notified', notifiedAt: new Date() } },
      )
      .exec();
  }
}
