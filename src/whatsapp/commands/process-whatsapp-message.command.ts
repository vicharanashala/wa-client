export class ProcessWhatsappMessageCommand {
  constructor(
    public readonly phoneNumber: string,
    public readonly messageText: string,
  ) {}
}
