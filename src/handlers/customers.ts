/**
 * Customers Handler
 * Syncs customers from Shopify to Google Sheets (ERP) via webhooks
 * Supports Shopify export format
 */

import { FromShopifyHandler } from './base';
import { sheetsClient } from '../integrations/googleSheets/client';

/**
 * Shopify customer webhook payload structure
 */
interface CustomerWebhookPayload {
  id: number;
  admin_graphql_api_id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  accepts_marketing: boolean;
  accepts_marketing_updated_at: string | null;
  sms_marketing_consent?: {
    state: string;
    opt_in_level: string;
  } | null;
  created_at: string;
  updated_at: string;
  orders_count: number;
  total_spent: string;
  note: string | null;
  tax_exempt: boolean;
  tags: string;
  addresses: Array<{
    id: number;
    address1: string;
    address2: string | null;
    city: string;
    province: string;
    province_code: string;
    country: string;
    country_code: string;
    zip: string;
    phone: string | null;
    company: string | null;
    default: boolean;
  }>;
  default_address?: {
    id: number;
    address1: string;
    address2: string | null;
    city: string;
    province: string;
    province_code: string;
    country: string;
    country_code: string;
    zip: string;
    phone: string | null;
    company: string | null;
  };
}

/**
 * Customer row matching Shopify export format
 */
interface CustomerRow {
  'Customer ID': string;
  'First Name': string;
  'Last Name': string;
  'Email': string;
  'Accepts Email Marketing': string;
  'Default Address Company': string;
  'Default Address Address1': string;
  'Default Address Address2': string;
  'Default Address City': string;
  'Default Address Province Code': string;
  'Default Address Country Code': string;
  'Default Address Zip': string;
  'Default Address Phone': string;
  'Phone': string;
  'Accepts SMS Marketing': string;
  'Total Spent': string;
  'Total Orders': string;
  'Note': string;
  'Tax Exempt': string;
  'Tags': string;
}

/**
 * Customers Handler class
 */
export class CustomersHandler extends FromShopifyHandler {
  constructor() {
    super('customers');
  }

  /**
   * Process webhook data and write to sheet
   * Writes in Shopify export format
   */
  protected async processWebhookData(
    topic: string,
    shopifyId: string,
    data: Record<string, unknown>
  ): Promise<void> {
    const customer = data as unknown as CustomerWebhookPayload;
    const sheetName = this.config.sheetName;

    // Get default address info
    const defaultAddr = customer.default_address || customer.addresses?.find(a => a.default) || customer.addresses?.[0];

    // Determine SMS marketing status
    const acceptsSms = customer.sms_marketing_consent?.state === 'subscribed' ? 'yes' : 'no';

    // Build customer row in Shopify export format
    const customerRow: CustomerRow = {
      'Customer ID': `'${customer.id}`, // Prefix with ' to prevent Excel number formatting
      'First Name': customer.first_name || '',
      'Last Name': customer.last_name || '',
      'Email': customer.email || '',
      'Accepts Email Marketing': customer.accepts_marketing ? 'yes' : 'no',
      'Default Address Company': defaultAddr?.company || '',
      'Default Address Address1': defaultAddr?.address1 || '',
      'Default Address Address2': defaultAddr?.address2 || '',
      'Default Address City': defaultAddr?.city || '',
      'Default Address Province Code': defaultAddr?.province_code || '',
      'Default Address Country Code': defaultAddr?.country_code || '',
      'Default Address Zip': defaultAddr?.zip || '',
      'Default Address Phone': defaultAddr?.phone || '',
      'Phone': customer.phone || '',
      'Accepts SMS Marketing': acceptsSms,
      'Total Spent': customer.total_spent || '0.00',
      'Total Orders': String(customer.orders_count || 0),
      'Note': customer.note || '',
      'Tax Exempt': customer.tax_exempt ? 'yes' : 'no',
      'Tags': customer.tags || '',
    };

    // Check if customer already exists by email or customer ID
    const existingRows = await sheetsClient.readAll(sheetName);
    const existingRow = existingRows.find(row => {
      const rowEmail = row.values.Email || row.values.email;
      const rowId = row.values['Customer ID'] || row.values.customer_id;
      // Remove leading apostrophe from ID for comparison
      const cleanRowId = rowId?.replace(/^'/, '');
      return rowEmail === customer.email || cleanRowId === String(customer.id);
    });

    if (existingRow) {
      // Update existing row
      await sheetsClient.updateRow(sheetName, existingRow.rowIndex, customerRow as unknown as Record<string, string>);
      this.log.info(`Customer ${customer.email} updated in sheet (${topic})`);
    } else {
      // Append new row
      await sheetsClient.appendRows(sheetName, [customerRow as unknown as Record<string, string>]);
      this.log.info(`Customer ${customer.email} added to sheet (${topic})`);
    }

    // Create ID mapping
    const shopifyGid = customer.admin_graphql_api_id || `gid://shopify/Customer/${customer.id}`;
    await this.createIdMapping(customer.email, shopifyGid);
  }
}

// Export handler instance
export const customersHandler = new CustomersHandler();
