/**
 * Configuration Schema Types
 * Defines the structure of the Switchboard configuration
 */

export type SyncDirection = 'to_shopify' | 'from_shopify' | 'bidirectional';
export type SyncTrigger = 'cron' | 'webhook';
export type SyncMode = 'sync' | 'overwrite';
export type ExistingDataBehavior = 'ignore' | 'adopt' | 'adopt_and_archive';
export type RunMode = 'demo' | 'production';

/**
 * Schedule configuration with separate production and demo settings
 */
export interface ScheduleConfig {
  production: string; // Cron expression for production mode
  demo: string; // Cron expression for demo mode (compressed timelines)
}

/**
 * Base configuration for all data objects
 */
export interface DataObjectConfig {
  enabled: boolean;
  direction: SyncDirection;
  trigger: SyncTrigger;
  schedule?: ScheduleConfig;
  webhookTopics?: string[];
  mode: SyncMode;
  sheetName: string;
  externalIdField?: string;
  existingDataBehavior?: ExistingDataBehavior;
  dependencies?: string[];
  settings?: Record<string, unknown>;
}

/**
 * Products-specific configuration
 */
export interface ProductsConfig extends DataObjectConfig {
  settings?: {
    includeVariants?: boolean;
    includeImages?: boolean;
  };
}

/**
 * Inventory-specific configuration
 */
export interface InventoryConfig extends DataObjectConfig {
  settings?: {
    defaultLocationName?: string;
  };
}

/**
 * Orders-specific configuration
 */
export interface OrdersConfig extends DataObjectConfig {
  settings?: {
    includeLineItems?: boolean;
    includeCustomer?: boolean;
  };
}

/**
 * Fulfillments-specific configuration
 */
export interface FulfillmentsConfig extends DataObjectConfig {
  settings?: {
    notifyCustomer?: boolean;
  };
}

/**
 * Catalogs-specific configuration
 */
export interface CatalogsConfig extends DataObjectConfig {
  settings?: {
    createIfNotExists?: boolean;
    matchMarketByName?: boolean;
  };
}

/**
 * Metaobjects-specific configuration
 */
export interface MetaobjectsConfig extends DataObjectConfig {
  settings?: {
    definitionHandle?: string;
    createDefinitionIfNotExists?: boolean;
  };
}

/**
 * Discounts-specific configuration
 */
export interface DiscountsConfig extends DataObjectConfig {
  settings?: {
    discountType?: 'code' | 'automatic';
  };
}

/**
 * Gift Cards-specific configuration
 */
export interface GiftCardsConfig extends DataObjectConfig {
  settings?: {
    createEnabled?: boolean;
  };
}

/**
 * Customers-specific configuration
 */
export interface CustomersConfig extends DataObjectConfig {
  settings?: {
    includeAddresses?: boolean;
    includeMetafields?: boolean;
  };
}

/**
 * All data objects configuration
 */
export interface DataObjectsConfig {
  products: ProductsConfig;
  inventory: InventoryConfig;
  orders: OrdersConfig;
  fulfillments: FulfillmentsConfig;
  catalogs: CatalogsConfig;
  metaobjects: MetaobjectsConfig;
  discounts: DiscountsConfig;
  giftCards: GiftCardsConfig;
  customers: CustomersConfig;
}

/**
 * Google Sheets configuration
 */
export interface GoogleSheetsConfig {
  spreadsheetId: string;
}

/**
 * Shopify configuration
 */
export interface ShopifyConfig {
  storeDomain: string;
  clientId: string;
  clientSecret: string;
  apiVersion: string;
}

/**
 * Main Switchboard configuration
 */
export interface SwitchboardConfig {
  mode: RunMode;
  webhookPort: number;
  heartbeatIntervalMs: number;
  googleSheets: GoogleSheetsConfig;
  shopify: ShopifyConfig;
  dataObjects: DataObjectsConfig;
}

/**
 * Type for data object names
 */
export type DataObjectName = keyof DataObjectsConfig;

/**
 * List of all data object names
 */
export const DATA_OBJECT_NAMES: DataObjectName[] = [
  'products',
  'inventory',
  'orders',
  'fulfillments',
  'catalogs',
  'metaobjects',
  'discounts',
  'giftCards',
  'customers',
];
