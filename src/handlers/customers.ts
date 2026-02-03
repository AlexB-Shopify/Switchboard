/**
 * Customers Handler
 * Syncs customers from Shopify to Google Sheets (ERP) via webhooks
 */

import { FromShopifyHandler } from './base';
import { appendCustomer } from '../integrations/googleSheets/operations';

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
  created_at: string;
  updated_at: string;
  addresses: Array<{
    id: number;
    address1: string;
    address2: string | null;
    city: string;
    province: string;
    country: string;
    zip: string;
    default: boolean;
  }>;
  default_address?: {
    id: number;
    address1: string;
    address2: string | null;
    city: string;
    province: string;
    country: string;
    zip: string;
  };
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
   */
  protected async processWebhookData(
    topic: string,
    shopifyId: string,
    data: Record<string, unknown>
  ): Promise<void> {
    const customer = data as unknown as CustomerWebhookPayload;

    // Get settings
    const settings = this.config.settings as { 
      includeAddresses?: boolean; 
      includeMetafields?: boolean 
    } | undefined;

    // Format addresses
    let addressesStr = '';
    if (settings?.includeAddresses && customer.addresses && customer.addresses.length > 0) {
      addressesStr = customer.addresses
        .map(addr => {
          const parts = [addr.address1];
          if (addr.address2) parts.push(addr.address2);
          parts.push(`${addr.city}, ${addr.province} ${addr.zip}`);
          parts.push(addr.country);
          return parts.join(', ');
        })
        .join(' | ');
    } else if (customer.default_address) {
      const addr = customer.default_address;
      addressesStr = [
        addr.address1,
        addr.address2,
        `${addr.city}, ${addr.province} ${addr.zip}`,
        addr.country,
      ].filter(Boolean).join(', ');
    }

    // Prepare the customer data for the sheet
    const customerData = {
      email: customer.email || '',
      first_name: customer.first_name || '',
      last_name: customer.last_name || '',
      phone: customer.phone || '',
      addresses: addressesStr,
      shopify_id: customer.admin_graphql_api_id || `gid://shopify/Customer/${customer.id}`,
    };

    // Write to sheet
    await appendCustomer(this.config.sheetName, customerData);

    // Create ID mapping
    await this.createIdMapping(customer.email, customerData.shopify_id);

    this.log.info(`Customer ${customer.email} synced to sheet (${topic})`);
  }
}

// Export handler instance
export const customersHandler = new CustomersHandler();
