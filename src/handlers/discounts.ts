/**
 * Discounts Handler
 * Syncs discount codes from Google Sheets (ERP) to Shopify
 */

import { ToShopifyHandler, type SourceItem } from './base';
import { sheetsClient } from '../integrations/googleSheets/client';
import { updateShopifyId } from '../integrations/googleSheets/operations';
import { createDiscountCode, getDiscounts } from '../integrations/shopify/queries';

/**
 * Helper to get a column value with multiple possible names (case-insensitive)
 */
function getColumn(values: Record<string, string>, ...keys: string[]): string {
  for (const key of keys) {
    // Try exact match first
    if (values[key] !== undefined) return values[key];
    // Try lowercase
    const lower = key.toLowerCase();
    if (values[lower] !== undefined) return values[lower];
    // Try with spaces replaced by underscores
    const underscore = lower.replace(/\s+/g, '_');
    if (values[underscore] !== undefined) return values[underscore];
    // Try normalized (lowercase, no special chars)
    const normalized = lower.replace(/[^a-z0-9]/g, '');
    for (const [k, v] of Object.entries(values)) {
      if (k.toLowerCase().replace(/[^a-z0-9]/g, '') === normalized) {
        return v;
      }
    }
  }
  return '';
}

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
   * Parse the discount type from various formats
   */
  private parseDiscountType(typeValue: string, valueTypeValue: string): 'percentage' | 'fixed' {
    // Check value_type first (Shopify export uses this)
    const valueType = valueTypeValue?.toLowerCase();
    if (valueType === 'percentage') return 'percentage';
    if (valueType === 'fixed_amount' || valueType === 'fixed') return 'fixed';
    
    // Fall back to type column
    const type = typeValue?.toLowerCase();
    if (type === 'fixed' || type === 'fixed_amount') return 'fixed';
    
    // Default to percentage
    return 'percentage';
  }

  /**
   * Read discounts from Google Sheets
   * Supports both Shopify export format and simplified ERP format
   */
  protected async readSourceItems(): Promise<DiscountRow[]> {
    const sheetName = this.config.sheetName;
    const rows = await sheetsClient.readAll(sheetName);

    return rows.map(row => {
      const v = row.values;
      
      // Get the value - Shopify exports it as negative (e.g., "-20.0")
      let value = getColumn(v, 'value', 'Value');
      // Remove negative sign if present (Shopify exports discounts as negative)
      if (value.startsWith('-')) {
        value = value.substring(1);
      }

      return {
        // Code - Shopify uses "Name" for the discount code
        code: getColumn(v, 'code', 'Name'),
        // Title - optional, falls back to code
        title: getColumn(v, 'title', 'Title') || getColumn(v, 'code', 'Name'),
        // Type - check both "type" and "Value Type" columns
        type: this.parseDiscountType(
          getColumn(v, 'type', 'Type', 'Discount Class'),
          getColumn(v, 'value_type', 'Value Type')
        ),
        // Value (percentage or amount)
        value,
        // Start date - Shopify uses "Start"
        starts_at: getColumn(v, 'starts_at', 'Start', 'start_date') || new Date().toISOString(),
        // End date - Shopify uses "End"
        ends_at: getColumn(v, 'ends_at', 'End', 'end_date'),
        // Shopify ID
        shopify_id: getColumn(v, 'shopify_id'),
        _rowIndex: row.rowIndex,
      };
    });
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
