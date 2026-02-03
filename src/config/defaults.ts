/**
 * Default Configuration Values
 * These can be overridden by the config file or environment variables
 */

import type { DataObjectsConfig, SwitchboardConfig } from './schema';

/**
 * Default data objects configuration
 */
export const defaultDataObjects: DataObjectsConfig = {
  products: {
    enabled: true,
    direction: 'to_shopify',
    trigger: 'cron',
    schedule: {
      production: '*/15 * * * *', // Every 15 minutes
      demo: '*/1 * * * *', // Every 1 minute
    },
    mode: 'sync',
    sheetName: 'Products',
    externalIdField: 'sku',
    existingDataBehavior: 'ignore',
    settings: {
      includeVariants: true,
      includeImages: false,
    },
  },

  inventory: {
    enabled: true,
    direction: 'to_shopify',
    trigger: 'cron',
    schedule: {
      production: '*/5 * * * *', // Every 5 minutes
      demo: '*/1 * * * *', // Every 1 minute
    },
    mode: 'sync',
    sheetName: 'Inventory',
    externalIdField: 'sku',
    existingDataBehavior: 'ignore',
    dependencies: ['products'],
    settings: {
      defaultLocationName: undefined,
    },
  },

  orders: {
    enabled: true,
    direction: 'from_shopify',
    trigger: 'webhook',
    webhookTopics: ['orders/create', 'orders/updated'],
    mode: 'sync',
    sheetName: 'Orders',
    existingDataBehavior: 'ignore',
    settings: {
      includeLineItems: true,
      includeCustomer: true,
    },
  },

  fulfillments: {
    enabled: true,
    direction: 'to_shopify',
    trigger: 'cron',
    schedule: {
      production: '*/10 * * * *', // Every 10 minutes
      demo: '*/1 * * * *', // Every 1 minute
    },
    mode: 'sync',
    sheetName: 'Fulfillments',
    externalIdField: 'order_number',
    existingDataBehavior: 'ignore',
    dependencies: ['orders'],
    settings: {
      notifyCustomer: true,
    },
  },

  catalogs: {
    enabled: true,
    direction: 'to_shopify',
    trigger: 'cron',
    schedule: {
      production: '0 * * * *', // Hourly
      demo: '*/2 * * * *', // Every 2 minutes
    },
    mode: 'sync',
    sheetName: 'Catalogs',
    externalIdField: 'name',
    existingDataBehavior: 'ignore',
    settings: {
      createIfNotExists: true,
      matchMarketByName: true,
    },
  },

  metaobjects: {
    enabled: true,
    direction: 'to_shopify',
    trigger: 'cron',
    schedule: {
      production: '*/30 * * * *', // Every 30 minutes
      demo: '*/1 * * * *', // Every 1 minute
    },
    mode: 'sync',
    sheetName: 'Content',
    externalIdField: 'handle',
    existingDataBehavior: 'ignore',
    settings: {
      definitionHandle: 'custom_content',
      createDefinitionIfNotExists: false,
    },
  },

  discounts: {
    enabled: false, // Disabled by default
    direction: 'to_shopify',
    trigger: 'cron',
    schedule: {
      production: '0 */6 * * *', // Every 6 hours
      demo: '*/5 * * * *', // Every 5 minutes
    },
    mode: 'overwrite',
    sheetName: 'Discounts',
    externalIdField: 'code',
    existingDataBehavior: 'ignore',
    settings: {
      discountType: 'code',
    },
  },

  giftCards: {
    enabled: false, // Disabled by default
    direction: 'bidirectional',
    trigger: 'cron',
    schedule: {
      production: '*/30 * * * *', // Every 30 minutes
      demo: '*/2 * * * *', // Every 2 minutes
    },
    mode: 'sync',
    sheetName: 'GiftCards',
    externalIdField: 'code',
    existingDataBehavior: 'ignore',
    settings: {
      createEnabled: true,
    },
  },

  customers: {
    enabled: true,
    direction: 'from_shopify',
    trigger: 'webhook',
    webhookTopics: ['customers/create', 'customers/update'],
    mode: 'sync',
    sheetName: 'Customers',
    existingDataBehavior: 'ignore',
    settings: {
      includeAddresses: true,
      includeMetafields: false,
    },
  },
};

/**
 * Default Switchboard configuration
 */
export const defaultConfig: Omit<SwitchboardConfig, 'shopify' | 'googleSheets'> & {
  shopify: Partial<SwitchboardConfig['shopify']>;
  googleSheets: Partial<SwitchboardConfig['googleSheets']>;
} = {
  mode: 'demo',
  webhookPort: 3000,
  heartbeatIntervalMs: 60000, // 1 minute
  googleSheets: {
    spreadsheetId: undefined,
  },
  shopify: {
    storeDomain: undefined,
    clientId: undefined,
    clientSecret: undefined,
    apiVersion: '2026-01',
  },
  dataObjects: defaultDataObjects,
};
