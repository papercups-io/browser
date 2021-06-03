import 'regenerator-runtime/runtime';
import {Papercups} from './index';

const w = window as any;
const config = (w.Papercups && w.Papercups.config) || {};
const {
  accountId,
  customerId,
  baseUrl,
  greeting,
  awayMessage,
  customer,
  debug,
  setInitialMessage,
  onSetCustomerId,
  onSetConversationId,
  onSetWidgetSettings,
  onPresenceSync,
  onConversationCreated,
  onMessageCreated,
  onMessagesUpdated,
} = config;

if (!accountId) {
  throw new Error('An account token is required to start Storytime!');
}

Papercups.init({
  accountId,
  customerId,
  baseUrl,
  greeting,
  awayMessage,
  customer,
  debug,
  setInitialMessage,
  onSetCustomerId,
  onSetConversationId,
  onSetWidgetSettings,
  onPresenceSync,
  onConversationCreated,
  onMessageCreated,
  onMessagesUpdated,
});
