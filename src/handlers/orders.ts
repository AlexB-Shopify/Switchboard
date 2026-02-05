/**
 * Orders Handler
 * Syncs orders from Shopify to Google Sheets (ERP) via webhooks
 * Supports Shopify export format where each line item is a separate row
 */

import { FromShopifyHandler } from './base';
import { sheetsClient } from '../integrations/googleSheets/client';
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
  subtotal_price: string;
  total_shipping_price_set?: { shop_money: { amount: string } };
  total_tax: string;
  currency: string;
  financial_status: string;
  fulfillment_status: string | null;
  created_at: string;
  updated_at: string;
  discount_codes?: Array<{ code: string; amount: string; type: string }>;
  shipping_lines?: Array<{ title: string }>;
  line_items: Array<{
    id: number;
    title: string;
    variant_title: string | null;
    quantity: number;
    sku: string | null;
    price: string;
    requires_shipping: boolean;
    taxable: boolean;
    fulfillment_status: string | null;
    vendor: string | null;
  }>;
  customer: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
    accepts_marketing: boolean;
  } | null;
  billing_address?: {
    name: string;
    address1: string;
    address2: string;
    company: string;
    city: string;
    zip: string;
    province: string;
    province_code: string;
    country: string;
    country_code: string;
    phone: string;
  };
  shipping_address?: {
    name: string;
    address1: string;
    address2: string;
    company: string;
    city: string;
    zip: string;
    province: string;
    province_code: string;
    country: string;
    country_code: string;
    phone: string;
  };
  note?: string;
  note_attributes?: Array<{ name: string; value: string }>;
  cancelled_at?: string;
  payment_gateway_names?: string[];
  source_name?: string;
  tags?: string;
}

/**
 * Order row matching Shopify export format
 */
interface OrderRow {
  Name: string;
  Email: string;
  'Financial Status': string;
  'Paid at'?: string;
  'Fulfillment Status': string;
  'Fulfilled at'?: string;
  'Accepts Marketing': string;
  Currency: string;
  Subtotal: string;
  Shipping: string;
  Taxes: string;
  Total: string;
  'Discount Code'?: string;
  'Discount Amount'?: string;
  'Shipping Method'?: string;
  'Created at': string;
  'Lineitem quantity': string;
  'Lineitem name': string;
  'Lineitem price': string;
  'Lineitem sku'?: string;
  'Lineitem requires shipping': string;
  'Lineitem taxable': string;
  'Lineitem fulfillment status': string;
  'Billing Name'?: string;
  'Billing Address1'?: string;
  'Billing Address2'?: string;
  'Billing Company'?: string;
  'Billing City'?: string;
  'Billing Zip'?: string;
  'Billing Province'?: string;
  'Billing Country'?: string;
  'Billing Phone'?: string;
  'Shipping Name'?: string;
  'Shipping Address1'?: string;
  'Shipping Address2'?: string;
  'Shipping Company'?: string;
  'Shipping City'?: string;
  'Shipping Zip'?: string;
  'Shipping Province'?: string;
  'Shipping Country'?: string;
  'Shipping Phone'?: string;
  Notes?: string;
  Vendor?: string;
  Id: string;
  Tags?: string;
  Source?: string;
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
   * Each line item becomes a separate row (Shopify export format)
   */
  protected async processWebhookData(
    topic: string,
    shopifyId: string,
    data: Record<string, unknown>
  ): Promise<void> {
    const order = data as unknown as OrderWebhookPayload;
    const sheetName = this.config.sheetName;

    // Check if order already exists (by Name)
    const existingRows = await sheetsClient.readAll(sheetName);
    const orderExists = existingRows.some(
      row => row.values.Name === order.name || row.values.name === order.name
    );

    if (orderExists && topic !== 'orders/updated') {
      this.log.debug(`Order ${order.name} already exists, skipping`);
      return;
    }

    // If updating, remove existing rows for this order first
    // (In a real implementation, you might want to update in place)
    // For simplicity, we'll just append new line items

    // Build rows - one per line item
    const rows: OrderRow[] = [];
    const lineItems = order.line_items || [];

    for (let i = 0; i < lineItems.length; i++) {
      const lineItem = lineItems[i];
      const isFirstLineItem = i === 0;

      // Build line item name with variant if present
      const lineItemName = lineItem.variant_title
        ? `${lineItem.title} - ${lineItem.variant_title}`
        : lineItem.title;

      const row: OrderRow = {
        // Order-level fields only on first row
        Name: order.name,
        Email: isFirstLineItem ? (order.email || '') : '',
        'Financial Status': isFirstLineItem ? (order.financial_status || '') : '',
        'Paid at': '', // Would need to track payment timestamp
        'Fulfillment Status': isFirstLineItem ? (order.fulfillment_status || 'unfulfilled') : '',
        'Fulfilled at': '',
        'Accepts Marketing': isFirstLineItem ? (order.customer?.accepts_marketing ? 'yes' : 'no') : '',
        Currency: isFirstLineItem ? order.currency : '',
        Subtotal: isFirstLineItem ? order.subtotal_price : '',
        Shipping: isFirstLineItem ? (order.total_shipping_price_set?.shop_money?.amount || '0.00') : '',
        Taxes: isFirstLineItem ? order.total_tax : '',
        Total: isFirstLineItem ? order.total_price : '',
        'Discount Code': isFirstLineItem ? (order.discount_codes?.[0]?.code || '') : '',
        'Discount Amount': isFirstLineItem ? (order.discount_codes?.[0]?.amount || '0.00') : '',
        'Shipping Method': isFirstLineItem ? (order.shipping_lines?.[0]?.title || '') : '',
        'Created at': order.created_at,

        // Line item fields (on every row)
        'Lineitem quantity': String(lineItem.quantity),
        'Lineitem name': lineItemName,
        'Lineitem price': lineItem.price,
        'Lineitem sku': lineItem.sku || '',
        'Lineitem requires shipping': lineItem.requires_shipping ? 'true' : 'false',
        'Lineitem taxable': lineItem.taxable ? 'true' : 'false',
        'Lineitem fulfillment status': lineItem.fulfillment_status || 'pending',

        // Addresses only on first row
        'Billing Name': isFirstLineItem ? (order.billing_address?.name || '') : '',
        'Billing Address1': isFirstLineItem ? (order.billing_address?.address1 || '') : '',
        'Billing Address2': isFirstLineItem ? (order.billing_address?.address2 || '') : '',
        'Billing Company': isFirstLineItem ? (order.billing_address?.company || '') : '',
        'Billing City': isFirstLineItem ? (order.billing_address?.city || '') : '',
        'Billing Zip': isFirstLineItem ? (order.billing_address?.zip || '') : '',
        'Billing Province': isFirstLineItem ? (order.billing_address?.province || '') : '',
        'Billing Country': isFirstLineItem ? (order.billing_address?.country_code || '') : '',
        'Billing Phone': isFirstLineItem ? (order.billing_address?.phone || '') : '',
        'Shipping Name': isFirstLineItem ? (order.shipping_address?.name || '') : '',
        'Shipping Address1': isFirstLineItem ? (order.shipping_address?.address1 || '') : '',
        'Shipping Address2': isFirstLineItem ? (order.shipping_address?.address2 || '') : '',
        'Shipping Company': isFirstLineItem ? (order.shipping_address?.company || '') : '',
        'Shipping City': isFirstLineItem ? (order.shipping_address?.city || '') : '',
        'Shipping Zip': isFirstLineItem ? (order.shipping_address?.zip || '') : '',
        'Shipping Province': isFirstLineItem ? (order.shipping_address?.province || '') : '',
        'Shipping Country': isFirstLineItem ? (order.shipping_address?.country_code || '') : '',
        'Shipping Phone': isFirstLineItem ? (order.shipping_address?.phone || '') : '',

        // Other fields
        Notes: isFirstLineItem ? (order.note || '') : '',
        Vendor: lineItem.vendor || '',
        Id: isFirstLineItem ? String(order.id) : '',
        Tags: isFirstLineItem ? (order.tags || '') : '',
        Source: isFirstLineItem ? (order.source_name || '') : '',
      };

      rows.push(row);
    }

    // If no line items, still create one row for the order
    if (rows.length === 0) {
      rows.push({
        Name: order.name,
        Email: order.email || '',
        'Financial Status': order.financial_status || '',
        'Paid at': '',
        'Fulfillment Status': order.fulfillment_status || 'unfulfilled',
        'Fulfilled at': '',
        'Accepts Marketing': order.customer?.accepts_marketing ? 'yes' : 'no',
        Currency: order.currency,
        Subtotal: order.subtotal_price,
        Shipping: order.total_shipping_price_set?.shop_money?.amount || '0.00',
        Taxes: order.total_tax,
        Total: order.total_price,
        'Discount Code': order.discount_codes?.[0]?.code || '',
        'Discount Amount': order.discount_codes?.[0]?.amount || '0.00',
        'Shipping Method': order.shipping_lines?.[0]?.title || '',
        'Created at': order.created_at,
        'Lineitem quantity': '0',
        'Lineitem name': '',
        'Lineitem price': '0',
        'Lineitem sku': '',
        'Lineitem requires shipping': 'false',
        'Lineitem taxable': 'false',
        'Lineitem fulfillment status': '',
        'Billing Name': order.billing_address?.name || '',
        'Billing Address1': order.billing_address?.address1 || '',
        'Billing Address2': order.billing_address?.address2 || '',
        'Billing Company': order.billing_address?.company || '',
        'Billing City': order.billing_address?.city || '',
        'Billing Zip': order.billing_address?.zip || '',
        'Billing Province': order.billing_address?.province || '',
        'Billing Country': order.billing_address?.country_code || '',
        'Billing Phone': order.billing_address?.phone || '',
        'Shipping Name': order.shipping_address?.name || '',
        'Shipping Address1': order.shipping_address?.address1 || '',
        'Shipping Address2': order.shipping_address?.address2 || '',
        'Shipping Company': order.shipping_address?.company || '',
        'Shipping City': order.shipping_address?.city || '',
        'Shipping Zip': order.shipping_address?.zip || '',
        'Shipping Province': order.shipping_address?.province || '',
        'Shipping Country': order.shipping_address?.country_code || '',
        'Shipping Phone': order.shipping_address?.phone || '',
        Notes: order.note || '',
        Vendor: '',
        Id: String(order.id),
        Tags: order.tags || '',
        Source: order.source_name || '',
      });
    }

    // Write all rows to sheet
    await sheetsClient.appendRows(sheetName, rows as unknown as Record<string, string>[]);

    // Create ID mapping (just for the order, not each line item)
    const shopifyGid = order.admin_graphql_api_id || `gid://shopify/Order/${order.id}`;
    await this.createIdMapping(order.name, shopifyGid);

    this.log.info(`Order ${order.name} synced to sheet with ${lineItems.length} line items (${topic})`);
  }
}

// Export handler instance
export const ordersHandler = new OrdersHandler();
