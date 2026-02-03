/**
 * Orders Handler
 * Syncs orders from Shopify to Google Sheets (ERP) via webhooks
 */

import { FromShopifyHandler } from './base';
import { appendOrder } from '../integrations/googleSheets/operations';
import { markWebhookProcessed } from '../db/client';

/**
 * Shopify order webhook payload structure
 */
interface OrderWebhookPayload {
  id: number;
  admin_graphql_api_id: string;
  name: string;
  email: string;
  total_price: string;
  currency: string;
  financial_status: string;
  fulfillment_status: string | null;
  created_at: string;
  updated_at: string;
  line_items: Array<{
    id: number;
    title: string;
    quantity: number;
    sku: string;
    price: string;
  }>;
  customer: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
  } | null;
}

/**
 * Orders Handler class
 */
export class OrdersHandler extends FromShopifyHandler {
  constructor() {
    super('orders');
  }

  /**
   * Process webhook data and write to sheet
   */
  protected async processWebhookData(
    topic: string,
    shopifyId: string,
    data: Record<string, unknown>
  ): Promise<void> {
    const order = data as unknown as OrderWebhookPayload;

    // Format line items as a string for the sheet
    const lineItemsStr = order.line_items
      .map(li => `${li.quantity}x ${li.title} (${li.sku || 'no SKU'})`)
      .join('; ');

    // Format customer name
    const customerName = order.customer
      ? `${order.customer.first_name} ${order.customer.last_name}`.trim()
      : '';

    // Prepare the order data for the sheet
    const orderData = {
      order_number: order.name,
      email: order.email || '',
      total: `${order.total_price} ${order.currency}`,
      financial_status: order.financial_status || '',
      fulfillment_status: order.fulfillment_status || 'unfulfilled',
      created_at: order.created_at,
      line_items: lineItemsStr,
      customer_name: customerName,
      shopify_id: order.admin_graphql_api_id || `gid://shopify/Order/${order.id}`,
    };

    // Write to sheet
    await appendOrder(this.config.sheetName, orderData);

    // Create ID mapping
    await this.createIdMapping(order.name, orderData.shopify_id);

    this.log.info(`Order ${order.name} synced to sheet (${topic})`);
  }
}

// Export handler instance
export const ordersHandler = new OrdersHandler();
