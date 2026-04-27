import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { UserTextMessageAddedEvent, UserVoiceMessageAddedEvent } from '../conversation.events';
import { Logger } from '@nestjs/common';
import { ConversationRepository } from '../../infrastructure/conversation.repository';
import { LlmService } from '../../../llm/llm.service';
import { WhatsappService } from '../../../whatsapp-api/whatsapp.service';
import { QuestionClassifierService } from '../../../llm/question-classifier.service';
import { toBaseMessages } from '../../../llm/message.mapper';
import { PendingQuestionRepository } from '../../../pending-questions/pending-question.repository';
import { Result, Ok, Err, Option, Some, None } from 'oxide.ts';

const REVIEWER_UPLOAD_TOOL = 'reviewer_new__upload_question_to_reviewer_system';

@EventsHandler(UserTextMessageAddedEvent, UserVoiceMessageAddedEvent)
export class IntelligentQuestionUploadHandler implements IEventHandler<UserTextMessageAddedEvent | UserVoiceMessageAddedEvent> {
  private readonly logger = new Logger(IntelligentQuestionUploadHandler.name);

  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly llmService: LlmService,
    private readonly whatsappService: WhatsappService,
    private readonly questionClassifier: QuestionClassifierService,
    private readonly pendingQuestionRepo: PendingQuestionRepository,
  ) { }

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
      ? await this.handleUploadSuccess(
        event.phoneNumber,
        messageContent,
        uploadResult.unwrap(),
        details.user_language || 'english',
      )
      : this.handleUploadError(event.phoneNumber, uploadResult.unwrapErr());
  }

  private async handleUploadSuccess(
    phoneNumber: string,
    queryText: string,
    result: string,
    userLanguage: string,
  ): Promise<void> {
    this.logger.log(
      `[${phoneNumber}] Uploaded to reviewer: ${result.slice(0, 100)}`,
    );
    await this.trackReviewerUpload(phoneNumber, queryText, result);
    
    let msg = 'Your message has been forwarded to the Agriculture Expert. You will receive a response shortly.';
    const lang = userLanguage.toLowerCase().trim();
    
    if (lang === 'punjabi') {
      msg = 'ਤੁਹਾਡਾ ਸੁਨੇਹਾ ਖੇਤੀਬਾੜੀ ਮਾਹਰ (Agriculture Expert) ਨੂੰ ਭੇਜ ਦਿੱਤਾ ਗਿਆ ਹੈ। ਤੁਹਾਨੂੰ ਜਲਦੀ ਹੀ ਇੱਕ ਜਵਾਬ ਮਿਲੇਗਾ।';
    } else if (lang === 'gujarati') {
      msg = 'તમારો પ્રશ્ન કૃષિ નિષ્ણાત (Agriculture Expert) ને મોકલવામાં આવ્યો છે. તમને ટૂંક સમયમાં જ એક જવાબ મળશે.';
    } else if (lang === 'bengali') {
      msg = 'আপনার বার্তা কৃষি বিশেষজ্ঞের (Agriculture Expert) কাছে পাঠানো হয়েছে। আপনি শীঘ্রই একটি উত্তর পাবেন।';
    } else if (lang === 'tamil') {
      msg = 'உங்கள் செய்தி வேளாண் நிபுணருக்கு (Agriculture Expert) அனுப்பப்பட்டுள்ளது. விரைவில் உங்களுக்கு பதில் கிடைக்கும்.';
    } else if (lang === 'telugu') {
      msg = 'మీ సందేశం వ్యవసాయ నిపుణులకు (Agriculture Expert) పంపబడింది. మీరు త్వరలో సమాధానం అందుకుంటారు.';
    } else if (lang === 'kannada') {
      msg = 'ನಿಮ್ಮ ಸಂದೇಶವನ್ನು ಕೃಷಿ ತಜ್ಞರಿಗೆ (Agriculture Expert) ಕಳುಹಿಸಲಾಗಿದೆ. ನೀವು ಶೀಘ್ರದಲ್ಲೇ ಉತ್ತರವನ್ನು ಪಡೆಯುತ್ತೀರಿ.';
    } else if (lang === 'malayalam') {
      msg = 'നിങ്ങളുടെ സന്ദേശം കൃഷി വിദഗ്ദ്ധന് (Agriculture Expert) അയച്ചിട്ടുണ്ട്. നിങ്ങൾക്ക് ഉടൻ തന്നെ മറുപടി ലഭിക്കും.';
    } else if (lang === 'odia') {
      msg = 'ଆପଣଙ୍କର ବାର୍ତ୍ତା କୃଷି ବିଶେଷଜ୍ଞଙ୍କ (Agriculture Expert) ନିକଟକୁ ପଠାଯାଇଛି | ଆପଣ ଶୀଘ୍ର ଏକ ଉତ୍ତର ପାଇବେ |';
    } else if (lang === 'hindi') {
      msg = 'आपका प्रश्न कृषि विशेषज्ञ (Agriculture Expert) को भेज दिया गया है। आपको जल्द ही इसका उत्तर मिलेगा।';
    }

    await Result.safe(this.whatsappService.sendTextMessage(phoneNumber, msg));
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
