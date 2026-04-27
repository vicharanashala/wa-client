import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Logger } from '@nestjs/common';
import { LangGraphClientService } from '../../langgraph-client.service';
import { WhatsappService } from '../../../whatsapp-api/whatsapp.service';

export class SetUserLocationCommand {
  constructor(
    public readonly phoneNumber: string,
    public readonly messageId: string,
    public readonly latitude: number,
    public readonly longitude: number,
    public readonly address?: string,
  ) {}
}

@CommandHandler(SetUserLocationCommand)
export class SetUserLocationHandler
  implements ICommandHandler<SetUserLocationCommand>
{
  private readonly logger = new Logger(SetUserLocationHandler.name);

  constructor(
    private readonly langGraph: LangGraphClientService,
    private readonly whatsappService: WhatsappService,
  ) {}

  async execute(command: SetUserLocationCommand): Promise<void> {
    const { phoneNumber, messageId, latitude, longitude, address } = command;

    this.logger.debug(
      `[${phoneNumber}] Location received: ${latitude},${longitude}${address ? ` (${address})` : ''}`,
    );

    // Acknowledge receipt first
    await this.whatsappService.markAsRead(messageId);

    // Forward location to LangGraph as a human message
    const { reply } = await this.langGraph.sendLocation(
      phoneNumber,
      latitude,
      longitude,
      address,
    );

    await this.whatsappService.sendTextMessage(phoneNumber, reply, messageId);
    this.logger.log(`[${phoneNumber}] Sent location-reply: "${reply.slice(0, 60)}"`);
  }
}
