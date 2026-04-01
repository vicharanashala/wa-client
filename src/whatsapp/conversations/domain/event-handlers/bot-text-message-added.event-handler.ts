import { EventsHandler, IEventHandler } from '@nestjs/cqrs';
import { BotTextMessageAddedEvent } from '../conversation.events';
import { Logger } from '@nestjs/common';
import { WhatsappService } from '../../../whatsapp-api/whatsapp.service';

@EventsHandler(BotTextMessageAddedEvent)
export class BotTextMessageAddedHandler implements IEventHandler<BotTextMessageAddedEvent> {
  private readonly logger = new Logger(BotTextMessageAddedHandler.name);

  constructor(private readonly whatsappService: WhatsappService) {}

  async handle(event: BotTextMessageAddedEvent): Promise<void> {

  }
}

