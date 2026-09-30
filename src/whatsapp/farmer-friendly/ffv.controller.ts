import { Controller, Post, Body, Logger } from '@nestjs/common';
import { FFVService } from './ffv-service';

interface FFVShowMoreRequest {
  questionId: string;
  phoneNumber: string;
}

@Controller('ffv')
export class FFVController {
  private readonly logger = new Logger(FFVController.name);

  constructor(private readonly ffvService: FFVService) {}

  /**
   * Handle "Show More" button clicks from WhatsApp interactive messages
   */
  @Post('show-more')
  async handleShowMore(@Body() body: FFVShowMoreRequest): Promise<{ success: boolean; data?: any }> {
    const { questionId, phoneNumber } = body;

    this.logger.log(`FFV Show More request: questionId=${questionId}, phone=${phoneNumber}`);

    const result = this.ffvService.getByQuestionId(questionId);

    if (!result.found) {
      return { success: false };
    }

    // Return the big answer data
    return {
      success: true,
      data: {
        bigAnswer: result.bigAnswer,
      },
    };
  }
}