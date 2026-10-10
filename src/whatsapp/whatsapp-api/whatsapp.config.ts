export const whatsappConfig = {
  accessToken:
    process.env.WHATSAPP_ACCESS_TOKEN ||
    '',
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  version: process.env.WHATSAPP_API_VERSION || 'v18.0',
  flowId: process.env.WHATSAPP_FLOW_ID || '',
  get apiUrl() {
    return `https://graph.facebook.com/${this.version}/${this.phoneNumberId}/messages`;
  },
};

export const locationConfig = {
  reviewerBackendBaseUrl:
    process.env.REVIEWER_BACKEND_BASE_URL ||
    'https://reviewer-backend-staging-239934307367.asia-south2.run.app',
};
