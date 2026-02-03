/**
 * Google Sheets Operations
 * Higher-level operations for syncing data with Google Sheets
 */

import { sheetsClient, type SheetRow } from './client';
import { logger } from '../../core/logger';

/**
 * Sync result for a batch operation
 */
export interface SyncResult {
  created: number;
  updated: number;
  failed: number;
  errors: Array<{ id: string; error: string }>;
}

/**
 * Read all items from a sheet as typed objects
 */
export async function readSheetItems<T extends Record<string, string>>(
  sheetName: string,
  transform?: (row: SheetRow) => T
): Promise<T[]> {
  const rows = await sheetsClient.readAll(sheetName);
  
  if (transform) {
    return rows.map(transform);
  }
  
  return rows.map(row => row.values as T);
}

/**
 * Read items that haven't been synced yet (no shopify_id)
 */
export async function readUnsyncedItems<T extends Record<string, string>>(
  sheetName: string,
  shopifyIdField: string = 'shopify_id'
): Promise<Array<T & { _rowIndex: number }>> {
  const rows = await sheetsClient.readAll(sheetName);
  
  return rows
    .filter(row => !row.values[shopifyIdField])
    .map(row => ({
      ...row.values as T,
      _rowIndex: row.rowIndex,
    }));
}

/**
 * Read items that have been synced (have shopify_id)
 */
export async function readSyncedItems<T extends Record<string, string>>(
  sheetName: string,
  shopifyIdField: string = 'shopify_id'
): Promise<Array<T & { _rowIndex: number }>> {
  const rows = await sheetsClient.readAll(sheetName);
  
  return rows
    .filter(row => row.values[shopifyIdField])
    .map(row => ({
      ...row.values as T,
      _rowIndex: row.rowIndex,
    }));
}

/**
 * Update the Shopify ID for a row
 */
export async function updateShopifyId(
  sheetName: string,
  rowIndex: number,
  shopifyId: string,
  shopifyIdField: string = 'shopify_id'
): Promise<void> {
  await sheetsClient.updateCell(sheetName, rowIndex, shopifyIdField, shopifyId);
}

/**
 * Batch update Shopify IDs
 */
export async function batchUpdateShopifyIds(
  sheetName: string,
  updates: Array<{ rowIndex: number; shopifyId: string }>,
  shopifyIdField: string = 'shopify_id'
): Promise<void> {
  await sheetsClient.batchUpdate(
    updates.map(u => ({
      sheetName,
      rowIndex: u.rowIndex,
      values: { [shopifyIdField]: u.shopifyId },
    }))
  );
}

/**
 * Write items from Shopify to sheet (for from_shopify direction)
 */
export async function writeItemsToSheet<T extends Record<string, string>>(
  sheetName: string,
  items: T[],
  externalIdField: string,
  shopifyIdField: string = 'shopify_id'
): Promise<SyncResult> {
  const result: SyncResult = {
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
  };

  for (const item of items) {
    const externalId = item[externalIdField] || item[shopifyIdField];
    
    try {
      const { action } = await sheetsClient.upsertRow(
        sheetName,
        externalIdField,
        item
      );

      if (action === 'created') {
        result.created++;
      } else {
        result.updated++;
      }
    } catch (error) {
      result.failed++;
      result.errors.push({
        id: externalId || 'unknown',
        error: error instanceof Error ? error.message : String(error),
      });
      logger.error(`Failed to write item ${externalId}: ${error}`, { dataObject: sheetName });
    }
  }

  return result;
}

/**
 * Sync orders from Shopify webhook payload to sheet
 */
export async function appendOrder(
  sheetName: string,
  order: {
    order_number: string;
    email: string;
    total: string;
    financial_status: string;
    fulfillment_status: string;
    created_at: string;
    line_items?: string;
    customer_name?: string;
    shopify_id: string;
  }
): Promise<void> {
  // Check if order already exists
  const existingRow = await sheetsClient.findRowByExternalId(
    sheetName,
    'order_number',
    order.order_number
  );

  if (existingRow) {
    await sheetsClient.updateRow(sheetName, existingRow.rowIndex, order);
  } else {
    await sheetsClient.appendRows(sheetName, [order]);
  }
}

/**
 * Sync customer from Shopify webhook payload to sheet
 */
export async function appendCustomer(
  sheetName: string,
  customer: {
    email: string;
    first_name: string;
    last_name: string;
    phone?: string;
    addresses?: string;
    shopify_id: string;
  }
): Promise<void> {
  // Check if customer already exists by email
  const existingRow = await sheetsClient.findRowByExternalId(
    sheetName,
    'email',
    customer.email
  );

  if (existingRow) {
    await sheetsClient.updateRow(sheetName, existingRow.rowIndex, customer);
  } else {
    await sheetsClient.appendRows(sheetName, [customer]);
  }
}

/**
 * Get all fulfillment requests (rows with tracking but no shopify fulfillment ID)
 */
export async function getPendingFulfillments(
  sheetName: string
): Promise<Array<{
  rowIndex: number;
  order_number: string;
  tracking_number: string;
  tracking_company: string;
  status: string;
}>> {
  const rows = await sheetsClient.readAll(sheetName);
  
  return rows
    .filter(row => 
      row.values.tracking_number && 
      row.values.status !== 'fulfilled' &&
      row.values.status !== 'synced'
    )
    .map(row => ({
      rowIndex: row.rowIndex,
      order_number: row.values.order_number || '',
      tracking_number: row.values.tracking_number || '',
      tracking_company: row.values.tracking_company || '',
      status: row.values.status || '',
    }));
}

/**
 * Mark a fulfillment as synced
 */
export async function markFulfillmentSynced(
  sheetName: string,
  rowIndex: number,
  shopifyFulfillmentId: string
): Promise<void> {
  await sheetsClient.batchUpdate([{
    sheetName,
    rowIndex,
    values: {
      status: 'synced',
      shopify_id: shopifyFulfillmentId,
    },
  }]);
}

/**
 * Validate sheet structure (headers match expected)
 */
export async function validateSheetStructure(
  sheetName: string,
  requiredHeaders: string[]
): Promise<{ valid: boolean; missingHeaders: string[] }> {
  const headers = await sheetsClient.getHeaders(sheetName);
  const normalizedRequired = requiredHeaders.map(h => 
    h.toLowerCase().trim().replace(/\s+/g, '_')
  );

  const missingHeaders = normalizedRequired.filter(h => !headers.includes(h));

  return {
    valid: missingHeaders.length === 0,
    missingHeaders,
  };
}

/**
 * Create sheet with headers if it doesn't exist
 * Note: This requires additional API permissions
 */
export async function ensureSheetExists(
  sheetName: string,
  headers: string[]
): Promise<boolean> {
  try {
    const sheets = await sheetsClient.getSheetsList();
    const exists = sheets.some(s => s.title === sheetName);
    
    if (exists) {
      return true;
    }

    // Sheet creation would require batchUpdate API
    // For now, just log a warning
    logger.warn(`Sheet '${sheetName}' does not exist. Please create it manually with headers: ${headers.join(', ')}`);
    return false;
  } catch (error) {
    logger.error(`Failed to check if sheet '${sheetName}' exists: ${error}`);
    return false;
  }
}
