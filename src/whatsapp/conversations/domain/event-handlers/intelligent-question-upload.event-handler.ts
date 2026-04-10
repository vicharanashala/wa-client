import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { UserTextMessageAddedEvent, UserVoiceMessageAddedEvent } from '../conversation.events';
import { Logger } from '@nestjs/common';
import { ConversationRepository } from '../../infrastructure/conversation.repository';
import { LlmService } from '../../../llm/llm.service';
import { QuestionClassifierService } from '../../../llm/question-classifier.service';
import { toBaseMessages } from '../../../llm/message.mapper';
import { PendingQuestionRepository } from '../../../pending-questions/pending-question.repository';
import { Result, Ok, Err, Option, Some, None } from 'oxide.ts';

const REVIEWER_UPLOAD_TOOL = 'upload_question_to_reviewer_system';

@EventsHandler(UserTextMessageAddedEvent, UserVoiceMessageAddedEvent)
export class IntelligentQuestionUploadHandler implements IEventHandler<UserTextMessageAddedEvent | UserVoiceMessageAddedEvent> {
  private readonly logger = new Logger(IntelligentQuestionUploadHandler.name);

  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly llmService: LlmService,
    private readonly questionClassifier: QuestionClassifierService,
    private readonly pendingQuestionRepo: PendingQuestionRepository,
  ) {}

  async handle(event: UserTextMessageAddedEvent | UserVoiceMessageAddedEvent): Promise<void> {
    const conversation = await Option(
      this.conversationRepository.findByPhone(event.phoneNumber),
    ).into();

    if (!conversation || !conversation.hasLocation) {
      return;
    }

    const messages = toBaseMessages(conversation.messages.slice(-15));
    const messageContent = 'content' in event ? event.content : event.transcript;

    const classification = await this.questionClassifier.classifyMessage(
      messageContent,
      messages,
    );

    this.logger.log(
      `[${event.phoneNumber}] Classification: ${classification.isUniqueQuestion ? 'UNIQUE' : 'NOT_UNIQUE'} ` +
        `(${classification.questionType}) - ${classification.reasoning}`,
    );

    if (classification.isUniqueQuestion) {
      const crop = classification.extractedDetails?.crop;
      const state = classification.extractedDetails?.state_name;

      const hasCrop = !!(crop && crop.toLowerCase() !== 'general' && crop.trim() !== '');
      const hasState = !!(state && state.toLowerCase() !== 'general' && state.trim() !== '');

      if (hasCrop && hasState) {
        await this.uploadQuestionToReviewer(event, classification);
      } else {
        this.logger.log(
          `[${event.phoneNumber}] Skipping force upload. Missing crop or state. Letting main LLM ask user. Details: ${JSON.stringify(classification.extractedDetails)}`,
        );
      }
    } else {
      this.logger.log(
        `[${event.phoneNumber}] Skipping upload (${classification.questionType})`,
      );
    }
  }

  private async uploadQuestionToReviewer(
    event: UserTextMessageAddedEvent | UserVoiceMessageAddedEvent,
    classification: any,
  ): Promise<void> {
    const messageContent = 'content' in event ? event.content : event.transcript;
    const details = classification.extractedDetails || {};
    const input = {
      question: details.improved_question && details.improved_question !== 'General' ? details.improved_question : messageContent,
      state_name: details.state_name || 'General',
      crop: details.crop || 'General',
      details: {
        state: details.state_name || 'General',
        district: details.district_name || 'General',
        crop: details.crop || 'General',
        season: 'General',
        domain: 'General',
      },
    };

    const uploadResult = await Result.safe(
      this.llmService.callTool(REVIEWER_UPLOAD_TOOL, input),
    );

    uploadResult.isOk()
      ? this.handleUploadSuccess(
          event.phoneNumber,
          messageContent,
          uploadResult.unwrap(),
        )
      : this.handleUploadError(event.phoneNumber, uploadResult.unwrapErr());
  }

  private handleUploadSuccess(
    phoneNumber: string,
    queryText: string,
    result: string,
  ): void {
    this.logger.log(
      `[${phoneNumber}] Uploaded to reviewer: ${result.slice(0, 100)}`,
    );
    this.trackReviewerUpload(phoneNumber, queryText, result);
  }

  private handleUploadError(phoneNumber: string, error: Error): void {
    this.logger.error(`[${phoneNumber}] Upload failed: ${error.message}`);
  }

  private async trackReviewerUpload(
    phoneNumber: string,
    queryText: string,
    result: string,
  ): Promise<void> {
    const questionId = this.extractQuestionId(result);

    questionId.isSome()
      ? await this.saveQuestionId(phoneNumber, queryText, questionId.unwrap())
      : this.logger.warn(
          `[${phoneNumber}] No question_id found in result: ${result.slice(0, 100)}`,
        );
  }

  private async saveQuestionId(
    phoneNumber: string,
    queryText: string,
    id: string,
  ): Promise<void> {
    const createResult = await Result.safe(
      this.pendingQuestionRepo.create({
        questionId: id,
        phoneNumber,
        queryText,
        toolCallId: `intelligent-${Date.now()}`,
      }),
    );

    createResult.isOk()
      ? this.logger.log(`[${phoneNumber}] Tracked pending question: ${id}`)
      : this.logger.error(
          `[${phoneNumber}] Failed to track question: ${createResult.unwrapErr().message}`,
        );
  }

  private extractQuestionId(result: string): Option<string> {
    const parseResult = Result.safe(() => {
      let parsed = JSON.parse(result);
      if (typeof parsed === 'string') {
        parsed = JSON.parse(parsed);
      }
      return parsed;
    });

    const fromParsed = parseResult.andThen((parsed) => {
      const id =
        parsed.question_id || parsed.questionId || parsed.id || parsed._id;
      if (id) return Ok(id);

      if (parsed.data) {
        const dataId =
          parsed.data.question_id ||
          parsed.data.questionId ||
          parsed.data.id ||
          parsed.data._id;
        if (dataId) return Ok(dataId);
      }

      if (parsed.result) {
        const resultId =
          parsed.result.question_id ||
          parsed.result.questionId ||
          parsed.result.id ||
          parsed.result._id;
        if (resultId) return Ok(resultId);
      }

      return Err(new Error('No ID found in parsed object'));
    });

    return fromParsed.or(this.extractIdFromString(result)).ok();
  }

  private extractIdFromString(result: string): Result<string, Error> {
    const mongoIdMatch = Option(
      result.match(
        /([a-fA-F0-9]{24})|([a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12})/,
      ),
    );

    if (mongoIdMatch.isSome()) {
      return Ok(mongoIdMatch.unwrap()[0]);
    }

    const genericIdMatch = Option(
      result.match(/id\s*[:=]\s*['"]?([a-zA-Z0-9_-]+)['"]?/i) ||
        result.match(/"id"\s*:\s*["']?([a-zA-Z0-9_-]+)["']?/i) ||
        result.match(/question_id\s*[:=]\s*['"]?([a-zA-Z0-9_-]+)['"]?/i),
    );

    return genericIdMatch.isSome()
      ? Ok(genericIdMatch.unwrap()[1])
      : Err(new Error('No ID pattern found in string'));
  }
}
