/**
 * Handlers Index
 * Exports all handlers and provides registration function
 */

import { jobQueue } from '../core/queue';
import type { DataObjectName } from '../config';
import { BaseHandler } from './base';

// Import all handlers
import { productsHandler } from './products';
import { inventoryHandler } from './inventory';
import { ordersHandler } from './orders';
import { fulfillmentsHandler } from './fulfillments';
import { catalogsHandler } from './catalogs';
import { metaobjectsHandler } from './metaobjects';
import { discountsHandler } from './discounts';
import { giftCardsHandler } from './giftCards';
import { customersHandler } from './customers';

/**
 * Map of data object names to handlers
 */
export const handlers: Record<DataObjectName, BaseHandler> = {
  products: productsHandler,
  inventory: inventoryHandler,
  orders: ordersHandler,
  fulfillments: fulfillmentsHandler,
  catalogs: catalogsHandler,
  metaobjects: metaobjectsHandler,
  discounts: discountsHandler,
  giftCards: giftCardsHandler,
  customers: customersHandler,
};

/**
 * Register all handlers with the job queue
 */
export function registerHandlers(): void {
  for (const [name, handler] of Object.entries(handlers)) {
    jobQueue.registerHandler(name as DataObjectName, (job) => handler.handle(job));
  }
}

// Export individual handlers
export { productsHandler } from './products';
export { inventoryHandler } from './inventory';
export { ordersHandler } from './orders';
export { fulfillmentsHandler } from './fulfillments';
export { catalogsHandler } from './catalogs';
export { metaobjectsHandler } from './metaobjects';
export { discountsHandler } from './discounts';
export { giftCardsHandler } from './giftCards';
export { customersHandler } from './customers';

// Export base classes
export { BaseHandler, ToShopifyHandler, FromShopifyHandler } from './base';
