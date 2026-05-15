/** Footer appended to manual reviewer sends on WhatsApp and LangGraph history. */
export function formatManualOutboundWhatsAppMessage(
  messageText: string,
  sendBy: string,
): string {
  const body = messageText.trimEnd();
  const expert = sendBy.trim();
  return `${body}\n\n👤 Agri Expert: ${expert}`;
}
