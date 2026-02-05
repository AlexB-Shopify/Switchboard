/**
 * Gift Cards Handler
 * Bidirectional sync of gift cards between Google Sheets (ERP) and Shopify
 * 
 * IMPORTANT: Gift Card Code Handling
 * ----------------------------------
 * - To CREATE new gift cards in Shopify, you need the FULL code in the `code` column
 *   (or leave it blank to let Shopify generate one)
 * - Shopify exports only provide `Last Characters` (last 4 digits), which is NOT enough
 *   to recreate the full code
 * - Gift cards imported from Shopify exports are READ-ONLY for balance sync purposes
 * 
 * Supported formats:
 * 1. Simplified ERP format: code, initial_value, balance, note, shopify_id
 * 2. Shopify export format: Id, Last Characters, Initial Balance, Current Balance, etc.
 */

import { BaseHandler, type SyncStats, type ItemResult } from './base';
import { sheetsClient } from '../integrations/googleSheets/client';
import { updateShopifyId } from '../integrations/googleSheets/operations';
import { createGiftCard, getGiftCards, type ShopifyGiftCard } from '../integrations/shopify/queries';
import { lookupByExternalId, lookupByShopifyId } from '../utils/idMapping';

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
 * Gift Card row from Google Sheets
 * Supports both simplified format and Shopify export format
 */
interface GiftCardRow {
  // Simplified ERP format
  code?: string;
  initial_value?: string;
  balance?: string;
  note?: string;
  shopify_id?: string;
  
  // Shopify export format
  id?: string;                    // Numeric Shopify ID
  last_characters?: string;       // Last 4 chars of code (for display/reference)
  customer_name?: string;
  customer_email?: string;
  recipient_name?: string;
  recipient_email?: string;
  order_name?: string;
  date_issued?: string;
  send_at?: string;
  expires_on?: string;
  initial_balance?: string;       // Shopify export uses this name
  current_balance?: string;       // Shopify export uses this name
  currency?: string;
  expired?: string;               // "true" or "false"
  enabled?: string;               // "true" or "false"
  disabled_at?: string;
  issuing_staff_member?: string;
  message?: string;
  
  _rowIndex: number;
}

/**
 * Gift Cards Handler class
 */
export class GiftCardsHandler extends BaseHandler {
  constructor() {
    super('giftCards');
  }

  /**
   * Perform the sync operation
   * For bidirectional sync, we:
   * 1. Push new gift cards from ERP to Shopify
   * 2. Pull updated balances from Shopify to ERP
   */
  protected async sync(): Promise<SyncStats> {
    const stats: SyncStats = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      unchanged: 0,
      created: 0,
      updated: 0,
      deleted: 0,
    };

    // Check if creation is enabled
    const settings = this.config.settings as { createEnabled?: boolean } | undefined;
    const createEnabled = settings?.createEnabled ?? true;

    // Step 1: Push new gift cards from ERP to Shopify
    if (createEnabled) {
      const erpGiftCards = await this.readSourceItems();
      
      // Find cards that are eligible for creation:
      // - No shopify_id AND no numeric id (not already linked to Shopify)
      // - Either has a full code OR we allow Shopify to generate one
      const newCards = erpGiftCards.filter(gc => {
        // Already linked to Shopify
        if (gc.shopify_id || gc.id) return false;
        
        // Has only last_characters but no full code - this is a Shopify export, skip
        if (gc.last_characters && !gc.code) {
          this.log.debug(`Skipping gift card with only last characters "${gc.last_characters}" - no full code available`);
          return false;
        }
        
        // Has a full code OR initial_value (let Shopify generate code)
        return gc.code || gc.initial_value || gc.initial_balance;
      });

      this.log.debug(`Found ${newCards.length} new gift cards to create (excludes Shopify export rows without full code)`);

      const createStats = await this.processBatch(newCards, async (item) => {
        return this.createGiftCardInShopify(item);
      });

      stats.processed += createStats.processed;
      stats.succeeded += createStats.succeeded;
      stats.failed += createStats.failed;
      stats.created += createStats.created;
    }

    // Step 2: Pull updated balances from Shopify to ERP
    const shopifyGiftCards = await getGiftCards();
    const erpGiftCards = await this.readSourceItems();
    
    // Build maps for quick lookup
    // By full Shopify GID
    const erpByShopifyId = new Map<string, GiftCardRow>();
    // By numeric ID (for Shopify export format)
    const erpByNumericId = new Map<string, GiftCardRow>();
    
    for (const gc of erpGiftCards) {
      if (gc.shopify_id) {
        erpByShopifyId.set(gc.shopify_id, gc);
        // Also extract numeric ID from GID
        const numericMatch = gc.shopify_id.match(/(\d+)$/);
        if (numericMatch) {
          erpByNumericId.set(numericMatch[1], gc);
        }
      }
      if (gc.id) {
        erpByNumericId.set(gc.id, gc);
      }
    }

    // Update balances in ERP
    const updates: Array<{ rowIndex: number; values: Record<string, string> }> = [];
    
    for (const shopifyGc of shopifyGiftCards) {
      // Try to find by GID first, then by numeric ID
      let erpGc = erpByShopifyId.get(shopifyGc.id);
      if (!erpGc) {
        const numericId = shopifyGc.id.match(/(\d+)$/)?.[1];
        if (numericId) {
          erpGc = erpByNumericId.get(numericId);
        }
      }
      
      if (erpGc) {
        // Get current balance from either format
        const currentBalance = erpGc.balance || erpGc.current_balance || '';
        const newBalance = shopifyGc.balance.amount;
        
        if (currentBalance !== newBalance) {
          // Determine which column names to use based on what exists
          const useShopifyFormat = erpGc.initial_balance !== undefined || erpGc.current_balance !== undefined;
          
          const updateValues: Record<string, string> = useShopifyFormat ? {
            'Id': erpGc.id || shopifyGc.id.match(/(\d+)$/)?.[1] || '',
            'Last Characters': erpGc.last_characters || '',
            'Initial Balance': erpGc.initial_balance || erpGc.initial_value || '',
            'Current Balance': newBalance,
            'Currency': erpGc.currency || shopifyGc.balance.currencyCode || '',
            'Note': erpGc.note || '',
          } : {
            code: erpGc.code || '',
            initial_value: erpGc.initial_value || erpGc.initial_balance || '',
            balance: newBalance,
            note: erpGc.note || '',
            shopify_id: erpGc.shopify_id || shopifyGc.id,
          };

          updates.push({
            rowIndex: erpGc._rowIndex,
            values: updateValues,
          });
          stats.updated++;
          stats.succeeded++;
        } else {
          stats.unchanged++;
        }
        stats.processed++;
      }
    }

    // Apply updates
    if (updates.length > 0) {
      await sheetsClient.batchUpdate(
        updates.map(u => ({
          sheetName: this.config.sheetName,
          rowIndex: u.rowIndex,
          values: u.values,
        }))
      );
    }

    return stats;
  }

  /**
   * Read gift cards from Google Sheets
   * Supports both simplified format and Shopify export format
   */
  private async readSourceItems(): Promise<GiftCardRow[]> {
    const sheetName = this.config.sheetName;
    const rows = await sheetsClient.readAll(sheetName);

    return rows.map(row => {
      const v = row.values;
      return {
        // Simplified ERP format
        code: getColumn(v, 'code', 'Code'),
        initial_value: getColumn(v, 'initial_value', 'initialvalue'),
        balance: getColumn(v, 'balance', 'Balance'),
        note: getColumn(v, 'note', 'Note'),
        shopify_id: getColumn(v, 'shopify_id', 'shopifyid'),
        
        // Shopify export format
        id: getColumn(v, 'Id', 'id'),
        last_characters: getColumn(v, 'Last Characters', 'lastcharacters', 'last_characters'),
        customer_name: getColumn(v, 'Customer Name', 'customername', 'customer_name'),
        customer_email: getColumn(v, 'Email', 'email', 'customer_email'),
        recipient_name: getColumn(v, 'Recipient Name', 'recipientname', 'recipient_name'),
        recipient_email: getColumn(v, 'Recipient Email', 'recipientemail', 'recipient_email'),
        order_name: getColumn(v, 'Order Name', 'ordername', 'order_name'),
        date_issued: getColumn(v, 'Date Issued', 'dateissued', 'date_issued'),
        send_at: getColumn(v, 'Send At', 'sendat', 'send_at'),
        expires_on: getColumn(v, 'Expires On', 'expireson', 'expires_on', 'expiry_date'),
        initial_balance: getColumn(v, 'Initial Balance', 'initialbalance', 'initial_balance'),
        current_balance: getColumn(v, 'Current Balance', 'currentbalance', 'current_balance'),
        currency: getColumn(v, 'Currency', 'currency'),
        expired: getColumn(v, 'Expired?', 'expired', 'is_expired'),
        enabled: getColumn(v, 'Enabled?', 'enabled', 'is_enabled'),
        disabled_at: getColumn(v, 'Disabled At', 'disabledat', 'disabled_at'),
        issuing_staff_member: getColumn(v, 'Issuing Staff Member', 'issuingstaffmember', 'issuing_staff'),
        message: getColumn(v, 'Message', 'message'),
        
        _rowIndex: row.rowIndex,
      };
    });
  }

  /**
   * Get the initial value from either format
   */
  private getInitialValue(item: GiftCardRow): string {
    return item.initial_value || item.initial_balance || '0';
  }

  /**
   * Create a gift card in Shopify
   * 
   * Note: To create a gift card in Shopify, you need EITHER:
   * 1. A full gift card code (16+ characters typically)
   * 2. Or leave code empty and Shopify will generate one
   * 
   * Shopify exports only provide "Last Characters" which is insufficient.
   */
  private async createGiftCardInShopify(item: GiftCardRow): Promise<ItemResult> {
    try {
      const initialValue = this.getInitialValue(item);
      
      if (!initialValue || parseFloat(initialValue) <= 0) {
        return this.failureResult(
          item.code || `row-${item._rowIndex}`,
          'Gift card requires a positive initial_value or Initial Balance'
        );
      }

      // Determine if we have a full code (typically 16+ chars) vs just last 4 chars
      const hasFullCode = item.code && item.code.length >= 8; // Shopify codes are typically 16-20 chars
      const identifier = item.code || `generated-${item._rowIndex}`;
      
      this.log.debug(`Creating gift card: ${hasFullCode ? 'with provided code' : 'Shopify will generate code'}, value: ${initialValue}`);
      
      const giftCard = await createGiftCard({
        initialValue,
        code: hasFullCode ? item.code : undefined, // Only pass if we have a usable code
        note: item.note || item.message || undefined,
      });

      // Update the sheet with the Shopify ID AND the full code if it was generated
      // This is important because the plaintext code is ONLY available at creation time!
      if (giftCard.plaintextCode && !hasFullCode) {
        // Write both the generated code and shopify_id back to the sheet
        await sheetsClient.batchUpdate([{
          sheetName: this.config.sheetName,
          rowIndex: item._rowIndex,
          values: {
            code: giftCard.plaintextCode,  // Save the full code!
            shopify_id: giftCard.id,
          },
        }]);
        this.log.info(`Gift card created with generated code: ${giftCard.plaintextCode} (saved to sheet)`);
      } else {
        // Just update the shopify_id
        await updateShopifyId(this.config.sheetName, item._rowIndex, giftCard.id);
      }

      // Create ID mapping - use the full code
      const mappingKey = giftCard.plaintextCode || item.code || giftCard.code;
      await this.createIdMapping(mappingKey, giftCard.id);

      return this.successResult('created', identifier, giftCard.id);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const identifier = item.code || `row-${item._rowIndex}`;
      return this.failureResult(identifier, errorMessage);
    }
  }
}

// Export handler instance
export const giftCardsHandler = new GiftCardsHandler();
