/**
 * Fulfillments Handler
 * Syncs fulfillments from Google Sheets (ERP) to Shopify
 * Depends on Orders handler (orders must exist first)
 */

import { BaseHandler, type SyncStats, type ItemResult } from './base';
import { 
  getPendingFulfillments, 
  markFulfillmentSynced 
} from '../integrations/googleSheets/operations';
import { getOrderByName, createFulfillment } from '../integrations/shopify/queries';
import { lookupByExternalId } from '../utils/idMapping';

/**
 * Fulfillment row from Google Sheets
 */
interface FulfillmentRow {
  rowIndex: number;
  order_number: string;
  tracking_number: string;
  tracking_company: string;
  status: string;
}

/**
 * Fulfillments Handler class
 */
export class FulfillmentsHandler extends BaseHandler {
  constructor() {
    super('fulfillments');
  }

  /**
   * Perform the sync operation
   */
  protected async sync(): Promise<SyncStats> {
    // Get pending fulfillments from sheet
    const pendingFulfillments = await getPendingFulfillments(this.config.sheetName);
    this.log.debug(`Found ${pendingFulfillments.length} pending fulfillments`);

    if (pendingFulfillments.length === 0) {
      return {
        processed: 0,
        succeeded: 0,
        failed: 0,
        unchanged: 0,
        created: 0,
        updated: 0,
        deleted: 0,
      };
    }

    // Process each fulfillment
    return this.processBatch(pendingFulfillments, async (item) => {
      return this.processFulfillment(item);
    });
  }

  /**
   * Process a single fulfillment
   */
  private async processFulfillment(item: FulfillmentRow): Promise<ItemResult> {
    const { rowIndex, order_number, tracking_number, tracking_company } = item;

    if (!order_number) {
      return this.failureResult(`row_${rowIndex}`, 'Missing order number');
    }

    try {
      // Look up the order's Shopify ID
      let orderId: string | null = null;

      // First try our ID mapping
      const orderMapping = await lookupByExternalId('orders', order_number);
      if (orderMapping.found) {
        orderId = orderMapping.shopifyId;
      }

      // If not found in mapping, try to find by order name
      if (!orderId) {
        const order = await getOrderByName(order_number);
        if (order) {
          orderId = order.id;
          // Create mapping for future lookups
          await this.createIdMapping(order_number, orderId);
        }
      }

      if (!orderId) {
        return this.failureResult(order_number, 'Order not found in Shopify');
      }

      // Get notify setting from config
      const settings = this.config.settings as { notifyCustomer?: boolean } | undefined;
      const notifyCustomer = settings?.notifyCustomer ?? true;

      // Create the fulfillment in Shopify
      const fulfillment = await createFulfillment(orderId, {
        trackingNumber: tracking_number || undefined,
        trackingCompany: tracking_company || undefined,
        notifyCustomer,
      });

      // Mark as synced in the sheet
      await markFulfillmentSynced(this.config.sheetName, rowIndex, fulfillment.id);

      return this.successResult('created', order_number, fulfillment.id);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return this.failureResult(order_number, errorMessage);
    }
  }
}

// Export handler instance
export const fulfillmentsHandler = new FulfillmentsHandler();
