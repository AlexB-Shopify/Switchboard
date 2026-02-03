/**
 * Gift Cards Handler
 * Bidirectional sync of gift cards between Google Sheets (ERP) and Shopify
 */

import { BaseHandler, type SyncStats, type ItemResult } from './base';
import { sheetsClient } from '../integrations/googleSheets/client';
import { updateShopifyId, writeItemsToSheet } from '../integrations/googleSheets/operations';
import { createGiftCard, getGiftCards, type ShopifyGiftCard } from '../integrations/shopify/queries';
import { lookupByExternalId, lookupByShopifyId } from '../utils/idMapping';

/**
 * Gift Card row from Google Sheets
 */
interface GiftCardRow {
  code: string;
  initial_value: string;
  balance?: string;
  note?: string;
  shopify_id?: string;
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
      const newCards = erpGiftCards.filter(gc => !gc.shopify_id);

      this.log.debug(`Found ${newCards.length} new gift cards to create`);

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
    
    // Build a map of Shopify ID to ERP row for quick lookup
    const erpByShopifyId = new Map<string, GiftCardRow>();
    for (const gc of erpGiftCards) {
      if (gc.shopify_id) {
        erpByShopifyId.set(gc.shopify_id, gc);
      }
    }

    // Update balances in ERP
    const updates: Array<{ rowIndex: number; values: Record<string, string> }> = [];
    
    for (const shopifyGc of shopifyGiftCards) {
      const erpGc = erpByShopifyId.get(shopifyGc.id);
      
      if (erpGc) {
        const currentBalance = erpGc.balance || '';
        const newBalance = shopifyGc.balance.amount;
        
        if (currentBalance !== newBalance) {
          updates.push({
            rowIndex: erpGc._rowIndex,
            values: {
              code: erpGc.code,
              initial_value: erpGc.initial_value,
              balance: newBalance,
              note: erpGc.note || '',
              shopify_id: erpGc.shopify_id || '',
            },
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
   */
  private async readSourceItems(): Promise<GiftCardRow[]> {
    const sheetName = this.config.sheetName;
    const rows = await sheetsClient.readAll(sheetName);

    return rows.map(row => ({
      code: row.values.code || '',
      initial_value: row.values.initial_value || '0',
      balance: row.values.balance || '',
      note: row.values.note || '',
      shopify_id: row.values.shopify_id || '',
      _rowIndex: row.rowIndex,
    }));
  }

  /**
   * Create a gift card in Shopify
   */
  private async createGiftCardInShopify(item: GiftCardRow): Promise<ItemResult> {
    try {
      const giftCard = await createGiftCard({
        initialValue: item.initial_value,
        code: item.code || undefined,
        note: item.note || undefined,
      });

      // Update the sheet with the Shopify ID
      await updateShopifyId(this.config.sheetName, item._rowIndex, giftCard.id);

      // Create ID mapping
      await this.createIdMapping(item.code || giftCard.code, giftCard.id);

      return this.successResult('created', item.code || giftCard.code, giftCard.id);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return this.failureResult(item.code || 'unknown', errorMessage);
    }
  }
}

// Export handler instance
export const giftCardsHandler = new GiftCardsHandler();
