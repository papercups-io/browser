export {Papercups} from './papercups';
export type {Config} from './papercups';
export {
  isAgentMessage,
  isCustomerMessage,
  isValidUuid,
  setupCustomEventHandlers,
  setupPostMessageHandlers,
  shouldActivateGameMode,
} from './utils';
export {
  fetchWidgetSettings,
  updateWidgetSettingsMetadata,
  createNewCustomer,
  isValidCustomer,
  updateCustomerMetadata,
  createNewConversation,
  findCustomerByExternalId,
  fetchCustomerConversations,
  upload,
} from './api';
