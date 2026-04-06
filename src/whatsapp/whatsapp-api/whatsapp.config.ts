export const whatsappConfig = {
  accessToken:
    process.env.META_ACCESS_TOKEN ||
    '',
  phoneNumberId: process.env.PHONE_NUMBER_ID || '',
  version: process.env.WHATSAPP_API_VERSION || 'v18.0',
  get apiUrl() {
    return `https://graph.facebook.com/${this.version}/${this.phoneNumberId}/messages`;
  },
};
