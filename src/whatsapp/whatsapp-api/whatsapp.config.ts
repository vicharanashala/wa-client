export const whatsappConfig = {
  accessToken:
    process.env.WHATSAPP_ACCESS_TOKEN ||
    '',
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  version: process.env.WHATSAPP_API_VERSION || 'v18.0',
  get apiUrl() {
    return `https://graph.facebook.com/${this.version}/${this.phoneNumberId}/messages`;
  },
};
