/**
 * Metaobjects Handler
 * Syncs metaobjects (content) from Google Sheets (ERP) to Shopify
 */

import { ToShopifyHandler, type SourceItem } from './base';
import { sheetsClient } from '../integrations/googleSheets/client';
import { updateShopifyId } from '../integrations/googleSheets/operations';
import { upsertMetaobject } from '../integrations/shopify/queries';

/**
 * Metaobject row from Google Sheets
 * Dynamic fields based on the metaobject definition
 */
interface MetaobjectRow extends SourceItem {
  handle: string;
  type?: string;
}

/**
 * Metaobjects Handler class
 */
export class MetaobjectsHandler extends ToShopifyHandler {
  constructor() {
    super('metaobjects');
  }

  /**
   * Get the metaobject definition handle from settings
   */
  private getDefinitionHandle(): string {
    const settings = this.config.settings as { definitionHandle?: string } | undefined;
    return settings?.definitionHandle || 'custom_content';
  }

  /**
   * Read metaobjects from Google Sheets
   */
  protected async readSourceItems(): Promise<MetaobjectRow[]> {
    const sheetName = this.config.sheetName;
    const rows = await sheetsClient.readAll(sheetName);

    return rows.map(row => {
      const item: MetaobjectRow = {
        handle: row.values.handle || '',
        type: row.values.type || this.getDefinitionHandle(),
        shopify_id: row.values.shopify_id || '',
        _rowIndex: row.rowIndex,
      };

      // Add all other fields dynamically
      for (const [key, value] of Object.entries(row.values)) {
        if (!['handle', 'type', 'shopify_id'].includes(key)) {
          item[key] = value;
        }
      }

      return item;
    });
  }

  /**
   * Create a metaobject in Shopify
   */
  protected async createInShopify(item: SourceItem): Promise<string> {
    const metaobjectRow = item as MetaobjectRow;
    const type = metaobjectRow.type || this.getDefinitionHandle();

    // Build fields array from the row data
    const fields = this.buildFieldsArray(metaobjectRow);

    const metaobject = await upsertMetaobject(type, metaobjectRow.handle, fields);
    return metaobject.id;
  }

  /**
   * Update a metaobject in Shopify
   */
  protected async updateInShopify(shopifyId: string, item: SourceItem): Promise<void> {
    const metaobjectRow = item as MetaobjectRow;
    const type = metaobjectRow.type || this.getDefinitionHandle();

    // Build fields array from the row data
    const fields = this.buildFieldsArray(metaobjectRow);

    // Upsert will update if handle exists
    await upsertMetaobject(type, metaobjectRow.handle, fields);
  }

  /**
   * Build fields array from metaobject row
   */
  private buildFieldsArray(row: MetaobjectRow): Array<{ key: string; value: string }> {
    const excludeKeys = ['handle', 'type', 'shopify_id', '_rowIndex'];
    const fields: Array<{ key: string; value: string }> = [];

    for (const [key, value] of Object.entries(row)) {
      if (!excludeKeys.includes(key) && value !== undefined && value !== '') {
        fields.push({
          key,
          value: String(value),
        });
      }
    }

    return fields;
  }

  /**
   * Update the Shopify ID in the source sheet
   */
  protected async updateSourceShopifyId(rowIndex: number, shopifyId: string): Promise<void> {
    await updateShopifyId(this.config.sheetName, rowIndex, shopifyId);
  }
}

// Export handler instance
export const metaobjectsHandler = new MetaobjectsHandler();
