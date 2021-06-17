import {Channel, Presence, Socket} from 'phoenix';
import {CustomerMetadata, Message, WidgetSettings} from './types';
import {areDatesEqual, getWebsocketUrl, isDev, isValidUuid} from './utils';
import * as API from './api';
import Logger from './logger';
import store from './storage';

export type Config = {
  accountId: string;
  customerId?: string | null;
  baseUrl?: string;
  greeting?: string;
  awayMessage?: string;
  customer?: CustomerMetadata;
  debug?: boolean;
  setInitialMessage?: (overrides?: Partial<Message>) => Array<Message>;
  onSetCustomerId?: (customerId: string | null) => void;
  onSetConversationId?: (conversationId: string) => void;
  onSetWidgetSettings?: (settings: WidgetSettings) => void;
  onPresenceSync?: (data: any) => void;
  onConversationCreated?: (customerId: string, data: any) => void;
  onMessageCreated?: (data: any) => void;
  onMessagesUpdated?: (messages: Array<Message>) => void;
};

export class Papercups {
  socket: Socket;
  channel?: Channel;
  logger: Logger;
  storage: any; // TODO
  config: Config;

  customerId: string | null;
  conversationId: string | null;
  messages: Array<Message>;
  settings: WidgetSettings;

  constructor(config: Config) {
    const w = window as any;
    const {baseUrl, customerId, debug: isDebugMode = false} = config;
    const debugModeEnabled = isDev(w) || isDebugMode;

    this.config = config;
    this.logger = new Logger(debugModeEnabled);
    this.storage = store(w);

    this.customerId = customerId || this.getCachedCustomerId() || null;
    this.conversationId = null;
    this.messages = [];
    this.settings = {};

    const websocketUrl = getWebsocketUrl(baseUrl);

    this.socket = new Socket(websocketUrl);
  }

  static init = (config: Config) => {
    return new Papercups(config);
  };

  start = async () => {
    this.connect();

    const settings = await this.fetchWidgetSettings();
    const isValidCustomer = await this.isValidCustomerId(this.customerId);
    const validatedCustomerId = isValidCustomer ? this.customerId : null;
    const metadata = this.config.customer || {};
    const customerId = await this.checkForExistingCustomer(
      metadata,
      validatedCustomerId
    );

    return this.setWidgetSettings(settings)
      .setCustomerId(customerId)
      .fetchLatestConversation(customerId);
  };

  connect = () => {
    this.socket.connect();
    this.listenForAgentAvailability();
  };

  disconnect = () => {
    this.socket.disconnect();
    this.channel?.leave();
  };

  setWidgetSettings = (settings: WidgetSettings) => {
    this.settings = settings;

    if (this.config.onSetWidgetSettings) {
      this.config.onSetWidgetSettings(settings);
    }

    return this;
  };

  setCustomerId = (customerId: string | null) => {
    this.customerId = customerId;
    this.cacheCustomerId(customerId);

    // Let other modules know that the customer has been set?
    window.dispatchEvent(
      new CustomEvent('papercups:customer:set', {
        detail: customerId,
      })
    );

    if (this.config.onSetCustomerId) {
      this.config.onSetCustomerId(customerId);
    }

    return this;
  };

  setConversationId = (conversationId: string) => {
    this.conversationId = conversationId;
    // TODO: should this be handled explicitly instead?
    this.joinConversationChannel(conversationId);

    if (this.config.onSetConversationId) {
      this.config.onSetConversationId(conversationId);
    }

    return this;
  };

  setMessages = (messages: Array<Message>) => {
    this.messages = messages;

    if (this.config.onMessagesUpdated) {
      this.config.onMessagesUpdated(messages);
    }

    return this;
  };

  listenForAgentAvailability = () => {
    const {accountId} = this.config;
    const room = this.socket.channel(`room:${accountId}`, {});

    room
      .join()
      .receive('ok', (res: any) => {
        this.logger.debug('Joined room successfully!', res);
      })
      .receive('error', (err: any) => {
        this.logger.debug('Unable to join room!', err);
      });

    const presence = new Presence(room);

    presence.onSync(() => {
      this.logger.debug('Syncing presence:', presence.list());
      this.config.onPresenceSync && this.config.onPresenceSync(presence);
    });

    return this;
  };

  listenForNewConversations = (customerId: string) => {
    const channel = this.socket.channel(`conversation:lobby:${customerId}`, {});

    // TODO: what does this data look like?
    channel.on('conversation:created', (data: any) => {
      this.config.onConversationCreated &&
        this.config.onConversationCreated(customerId, data);
      // TODO: is the setTimeout still necessary? it shouldn't be...
      setTimeout(() => this.fetchLatestConversation(customerId), 1000);
    });

    channel
      .join()
      .receive('ok', (res: any) => {
        this.logger.debug('Successfully listening for new conversations!', res);
      })
      .receive('error', (err: any) => {
        this.logger.debug('Unable to listen for new conversations!', err);
      });

    return this;
  };

  joinConversationChannel = (
    conversationId: string,
    fallbackCustomerId?: string
  ) => {
    if (this.channel && this.channel.leave) {
      this.channel.leave(); // TODO: what's the best practice here?
    }

    const customerId = this.customerId || fallbackCustomerId;

    this.logger.debug('Joining channel:', conversationId);
    this.channel = this.socket.channel(`conversation:${conversationId}`, {
      customer_id: customerId,
    });

    this.channel.on('shout', (message: any) => {
      this.handleMessageCreated(message);
      this.config.onMessageCreated && this.config.onMessageCreated(message);
    });

    this.channel
      .join()
      .receive('ok', (res: any) => {
        this.logger.debug('Joined conversation successfully!', res);
      })
      .receive('error', (err: any) => {
        this.logger.debug('Unable to join conversation!', err);
      });

    return this;
  };

  createNewConversation = async (customerId: string) => {
    const {accountId, baseUrl} = this.config;

    return API.createNewConversation(accountId, customerId, baseUrl);
  };

  initializeNewConversation = async (
    existingCustomerId?: string | null,
    email?: string
  ) => {
    const {customer = {}} = this.config;
    const metadata = email ? {...customer, email} : customer;
    const customerId = await this.createOrUpdateCustomer(
      existingCustomerId,
      metadata
    );
    const {id: conversationId} = await this.createNewConversation(customerId);

    return this.setCustomerId(customerId).setConversationId(conversationId);
  };

  updateCustomerMetadata = (customerId: string, metadata: CustomerMetadata) => {
    const {baseUrl} = this.config;

    return API.updateCustomerMetadata(customerId, metadata, baseUrl);
  };

  createNewCustomer = (customer: CustomerMetadata) => {
    const {baseUrl, accountId} = this.config;

    return API.createNewCustomer(accountId, customer, baseUrl);
  };

  identify = async (externalId: string, metadata = {}) => {
    try {
      const existingCustomerId = await this.findCustomerByExternalId(
        externalId
      );
      const customer = existingCustomerId
        ? await this.updateCustomerMetadata(existingCustomerId, metadata)
        : await this.createNewCustomer(metadata);

      return customer;
    } catch (err) {
      // TODO: this edge case may occur if the cached customer ID somehow
      // gets messed up (e.g. between dev and prod environments). The long term
      // fix should be changing the cache key for different environments.
      this.logger.error('Failed to update or create customer:', err);
      this.logger.error('Retrying...');

      const customer = await this.createNewCustomer(metadata);

      return customer;
    }
  };

  // This is very similar to `identify` above, but only used internally
  createOrUpdateCustomer = async (
    existingCustomerId?: string | null,
    metadata: Partial<CustomerMetadata> = {}
  ): Promise<string> => {
    try {
      const customer = existingCustomerId
        ? await this.updateCustomerMetadata(existingCustomerId, metadata)
        : await this.createNewCustomer(metadata);
      const {id: customerId} = customer;

      return customerId;
    } catch (err) {
      // TODO: this edge case may occur if the cached customer ID somehow
      // gets messed up (e.g. between dev and prod environments). The long term
      // fix should be changing the cache key for different environments.
      this.logger.error('Failed to update or create customer:', err);
      this.logger.error('Retrying...');

      const {id: customerId} = await this.createNewCustomer(metadata);

      return customerId;
    }
  };

  fetchWidgetSettings = async (): Promise<WidgetSettings> => {
    const {accountId, baseUrl} = this.config;
    const empty = {} as WidgetSettings;

    return API.fetchWidgetSettings(accountId, baseUrl)
      .then((settings) => settings || empty)
      .catch(() => empty);
  };

  updateWidgetSettingsMetadata = async (metadata: any) => {
    const {accountId, baseUrl} = this.config;

    return API.updateWidgetSettingsMetadata(accountId, metadata, baseUrl).catch(
      (err) => {
        // No need to block on this
        this.logger.error('Failed to update widget metadata:', err);
      }
    );
  };

  findCustomerByExternalId = async (
    externalId: string,
    filters = {}
  ): Promise<string | null> => {
    const {accountId, baseUrl} = this.config;
    const {customer_id: matchingCustomerId} =
      await API.findCustomerByExternalId(
        externalId,
        accountId,
        filters,
        baseUrl
      );

    return matchingCustomerId;
  };

  findCustomerByMetadata = async (
    metadata: CustomerMetadata
  ): Promise<string | null> => {
    if (!metadata || !metadata?.external_id) {
      return null;
    }

    // NB: we check for matching existing customers based on external_id, email,
    // and host -- this may break across subdomains, but I think this is fine for now.
    const {email, host, external_id: externalId} = metadata;
    const filters = {email, host};
    const customerId = await this.findCustomerByExternalId(externalId, filters);

    return customerId;
  };

  checkForExistingCustomer = async (
    metadata: CustomerMetadata,
    defaultCustomerId: string | null = null
  ): Promise<string | null> => {
    if (!metadata || !metadata?.external_id) {
      return defaultCustomerId;
    }

    const matchingCustomerId = await this.findCustomerByMetadata(metadata);

    if (!matchingCustomerId) {
      return null;
    } else if (matchingCustomerId === defaultCustomerId) {
      return defaultCustomerId;
    } else {
      // Emit update so we can cache the ID in the parent window???
      // this.setCustomerId(matchingCustomerId);

      return matchingCustomerId;
    }
  };

  updateExistingCustomer = async (
    customerId: string,
    metadata?: CustomerMetadata
  ) => {
    if (!metadata) {
      return;
    }

    try {
      await this.updateCustomerMetadata(customerId, metadata);
    } catch (err) {
      this.logger.debug('Error updating customer metadata!', err);
    }
  };

  fetchLatestCustomerConversation = async (customerId: string) => {
    const {accountId, baseUrl} = this.config;

    return API.fetchCustomerConversations(customerId, accountId, baseUrl).then(
      (conversations) => {
        this.logger.debug('Found existing conversations:', conversations);
        const [latest] = conversations;

        return latest || null;
      }
    );
  };

  getCachedCustomerId = () => {
    return this.storage.getCustomerId();
  };

  cacheCustomerId = (customerId: string | null) => {
    this.logger.debug('Caching customer ID:', customerId);

    if (!customerId) {
      this.storage.removeCustomerId();
    } else {
      // TODO: don't depend on storage working? (also add support for local/session/cookies)
      this.storage.setCustomerId(customerId);
    }
  };

  markMessagesAsSeen = () => {
    this.channel?.push('messages:seen', {});

    const messages = this.messages.map((msg) => {
      return msg.seen_at ? msg : {...msg, seen_at: new Date().toISOString()};
    });

    this.setMessages(messages);
  };

  sendNewMessage = async (message: Partial<Message>, email?: string) => {
    const {customerId, conversationId} = this;
    const {body = '', file_ids = []} = message;
    const isMissingBody = !body || body.trim().length === 0;
    const isMissingAttachments = !file_ids || file_ids.length === 0;
    const isInvalidMessage = isMissingBody && isMissingAttachments;

    // TODO: how should we handle no channel connected?
    if (isInvalidMessage) {
      return;
    }

    // TODO: this seems to be unreliable
    const sentAt = new Date().toISOString();
    // TODO: figure out how this should work if `customerId` is null
    const payload: Message = {
      ...message,
      body,
      customer_id: customerId,
      type: 'customer',
      sent_at: sentAt,
    };

    // Optimistic update?
    this.setMessages([...this.messages, payload]);

    if (!customerId || !conversationId) {
      // TODO: this feels a bit hacky...
      // Can/should we just create the message within this call?
      await this.initializeNewConversation(customerId, email);
    }

    this.channel?.push('shout', {
      ...message,
      body,
      customer_id: this.customerId,
      sent_at: sentAt,
    });
  };

  handleMessageCreated = (message: Message) => {
    const {messages = []} = this;
    const unsent = messages.find(
      (m) =>
        !m.created_at &&
        areDatesEqual(m.sent_at, message.sent_at) &&
        (m.body === message.body || (!m.body && !message.body))
    );
    const updated = unsent
      ? messages.map((m) => (m.sent_at === unsent.sent_at ? message : m))
      : [...messages, message];

    this.setMessages(updated);
  };

  isValidCustomer = (customerId: string) => {
    const {baseUrl, accountId} = this.config;

    return API.isValidCustomer(customerId, accountId, baseUrl);
  };

  isValidCustomerId = async (customerId?: string | null) => {
    if (!customerId || !customerId.length) {
      return false;
    }

    if (!isValidUuid(customerId)) {
      return false;
    }

    try {
      const isValidCustomer = await this.isValidCustomer(customerId);

      return isValidCustomer;
    } catch (err) {
      this.logger.warn('Failed to validate customer ID.');
      this.logger.warn('You might be on an older version of Papercups.');
      // Return true for backwards compatibility
      return true;
    }
  };

  formatCustomerMetadata = () => {
    const {customer = {}} = this.config;

    if (!customer) {
      return {};
    }

    return Object.keys(customer).reduce((acc, key) => {
      if (key === 'metadata') {
        return {...acc, [key]: customer[key]};
      } else {
        // Make sure all other passed-in values are strings
        return {...acc, [key]: String(customer[key])};
      }
    }, {});
  };

  getDefaultGreeting = (overrides = {}): Array<Message> => {
    if (this.config.setInitialMessage) {
      return this.config.setInitialMessage(overrides);
    }

    const greeting = this.config.greeting || this.settings.greeting;
    const awayMessage = this.config.awayMessage || this.settings.away_message;

    if (!greeting && !awayMessage) {
      return [];
    }

    const hasAwayMessage = awayMessage && awayMessage.length > 0;
    const isOutsideWorkingHours =
      !!this.settings?.account?.is_outside_working_hours;
    const shouldDisplayAwayMessage = hasAwayMessage && isOutsideWorkingHours;

    return [
      {
        type: 'bot',
        customer_id: 'bot',
        body: shouldDisplayAwayMessage ? awayMessage : greeting,
        created_at: new Date().toISOString(), // TODO: what should this be?
        ...overrides,
      },
    ];
  };

  fetchLatestConversation = async (
    fallbackCustomerId: string | null = null
  ) => {
    try {
      const customerId = this.customerId || fallbackCustomerId;

      if (!customerId) {
        // If there's no customerId, we haven't seen this customer before,
        // so do nothing until they try to create a new message
        this.setMessages([...this.getDefaultGreeting()]);

        return null;
      }

      this.logger.debug('Fetching conversations for customer:', customerId);

      const conversation = await this.fetchLatestCustomerConversation(
        customerId
      );

      if (!conversation) {
        // If there are no conversations yet, wait until the customer creates
        // a new message to create the new conversation
        this.setMessages([
          ...this.getDefaultGreeting(),
        ]).listenForNewConversations(customerId);

        return null;
      }

      const {id: conversationId, messages = []} = conversation;
      const formattedMessages = messages.sort(
        (a: any, b: any) => +new Date(a.created_at) - +new Date(b.created_at)
      );
      const [initialMessage] = formattedMessages;
      const initialMessageCreatedAt = initialMessage?.created_at;

      this.setConversationId(conversationId).setMessages([
        ...this.getDefaultGreeting({
          created_at: initialMessageCreatedAt,
          seen_at: initialMessageCreatedAt,
        }),
        ...formattedMessages,
      ]);

      return conversation;
    } catch (err) {
      this.logger.debug('Error fetching conversations!', err);
    }
  };

  notify = (type: 'slack' | 'email', message: string, options = {}) => {
    this.logger.debug({type, message, options});
    // TODO: make it super easy to send notifications from brower
    // consider rate limiting? blacklisting/whitelisting?
    // start new conversation vs send in existing?
    // tagging/labeling from function? (e.g. "feedback", "bug", etc?)
    // options can include... name, email, customer info, metadata?
  };
}
