/**
 * Discounts Handler
 * Syncs discount codes from Google Sheets (ERP) to Shopify
 */

import { ToShopifyHandler, type SourceItem } from './base';
import { sheetsClient } from '../integrations/googleSheets/client';
import { updateShopifyId } from '../integrations/googleSheets/operations';
import { createDiscountCode, getDiscounts } from '../integrations/shopify/queries';

/**
 * Discount row from Google Sheets
 */
interface DiscountRow extends SourceItem {
  code: string;
  title?: string;
  type: 'percentage' | 'fixed';
  value: string;
  starts_at: string;
  ends_at?: string;
}

/**
 * Discounts Handler class
 */
export class DiscountsHandler extends ToShopifyHandler {
  constructor() {
    super('discounts');
  }

  /**
   * Read discounts from Google Sheets
   */
  protected async readSourceItems(): Promise<DiscountRow[]> {
    const sheetName = this.config.sheetName;
    const rows = await sheetsClient.readAll(sheetName);

    return rows.map(row => ({
      code: row.values.code || '',
      title: row.values.title || row.values.code || '',
      type: (row.values.type?.toLowerCase() === 'fixed' ? 'fixed' : 'percentage') as 'percentage' | 'fixed',
      value: row.values.value || '0',
      starts_at: row.values.starts_at || new Date().toISOString(),
      ends_at: row.values.ends_at || '',
      shopify_id: row.values.shopify_id || '',
      _rowIndex: row.rowIndex,
    }));
  }

  /**
   * Create a discount in Shopify
   */
  protected async createInShopify(item: SourceItem): Promise<string> {
    const discountRow = item as DiscountRow;

    // Build the value object based on type
    const value: { 
      percentage?: number; 
      fixedAmount?: { amount: string; currencyCode: string } 
    } = {};

    if (discountRow.type === 'percentage') {
      value.percentage = parseFloat(discountRow.value) || 0;
    } else {
      value.fixedAmount = {
        amount: discountRow.value,
        currencyCode: 'USD', // TODO: Get from config or sheet
      };
    }

    // Format dates
    const startsAt = discountRow.starts_at 
      ? new Date(discountRow.starts_at).toISOString()
      : new Date().toISOString();
    
    const endsAt = discountRow.ends_at 
      ? new Date(discountRow.ends_at).toISOString()
      : undefined;

    const discount = await createDiscountCode({
      title: discountRow.title || discountRow.code,
      code: discountRow.code,
      startsAt,
      endsAt,
      value,
    });

    return discount.id;
  }

  /**
   * Update a discount in Shopify
   * Note: Discount updates are limited in Shopify API
   */
  protected async updateInShopify(shopifyId: string, item: SourceItem): Promise<void> {
    // Shopify discount updates are limited
    // For overwrite mode, we would need to delete and recreate
    this.log.debug(`Discount update requested for ${shopifyId} - limited update support`);
  }

  /**
   * Update the Shopify ID in the source sheet
   */
  protected async updateSourceShopifyId(rowIndex: number, shopifyId: string): Promise<void> {
    await updateShopifyId(this.config.sheetName, rowIndex, shopifyId);
  }
}

// Export handler instance
export const discountsHandler = new DiscountsHandler();
