/**
 * Catalogs Handler
 * Syncs catalogs from Google Sheets (ERP) to Shopify
 */

import { ToShopifyHandler, type SourceItem } from './base';
import { sheetsClient } from '../integrations/googleSheets/client';
import { updateShopifyId } from '../integrations/googleSheets/operations';
import { getCatalogs, createCatalog, type ShopifyCatalog } from '../integrations/shopify/queries';
import { shopifyClient } from '../integrations/shopify/client';

/**
 * Catalog row from Google Sheets
 */
interface CatalogRow extends SourceItem {
  name: string;
  market?: string;
  product_skus?: string;
}

/**
 * Catalogs Handler class
 */
export class CatalogsHandler extends ToShopifyHandler {
  private marketCache: Map<string, string> = new Map();

  constructor() {
    super('catalogs');
  }

  /**
   * Read catalogs from Google Sheets
   */
  protected async readSourceItems(): Promise<CatalogRow[]> {
    const sheetName = this.config.sheetName;
    const rows = await sheetsClient.readAll(sheetName);

    return rows.map(row => ({
      name: row.values.name || '',
      market: row.values.market || '',
      product_skus: row.values.product_skus || '',
      shopify_id: row.values.shopify_id || '',
      _rowIndex: row.rowIndex,
    }));
  }

  /**
   * Load markets from Shopify
   */
  private async loadMarkets(): Promise<void> {
    const markets = await shopifyClient.getMarkets();
    
    this.marketCache.clear();
    for (const market of markets) {
      this.marketCache.set(market.name.toLowerCase(), market.id);
      this.marketCache.set(market.handle.toLowerCase(), market.id);
    }

    this.log.debug(`Loaded ${markets.length} markets`);
  }

  /**
   * Get market ID by name
   */
  private getMarketId(marketName: string): string | null {
    return this.marketCache.get(marketName.toLowerCase()) || null;
  }

  /**
   * Create a catalog in Shopify
   */
  protected async createInShopify(item: SourceItem): Promise<string> {
    const catalogRow = item as CatalogRow;

    // Check settings
    const settings = this.config.settings as { createIfNotExists?: boolean; matchMarketByName?: boolean } | undefined;

    // Check if catalog already exists by name
    const existingCatalogs = await getCatalogs();
    const existing = existingCatalogs.find(c => 
      c.title.toLowerCase() === catalogRow.name.toLowerCase()
    );

    if (existing) {
      // Adopt existing catalog
      return existing.id;
    }

    if (!settings?.createIfNotExists) {
      throw new Error(`Catalog "${catalogRow.name}" does not exist and createIfNotExists is false`);
    }

    // Create the catalog
    const catalog = await createCatalog(catalogRow.name);

    // If market matching is enabled, try to associate with market
    if (settings?.matchMarketByName && catalogRow.market) {
      await this.loadMarkets();
      const marketId = this.getMarketId(catalogRow.market);
      
      if (marketId) {
        this.log.debug(`Market matched: ${catalogRow.market} -> ${marketId}`);
        // Note: Catalog-market association would require additional API call
        // This is a placeholder for the market association logic
      } else {
        this.log.warn(`Market not found: ${catalogRow.market}`);
      }
    }

    return catalog.id;
  }

  /**
   * Update a catalog in Shopify
   */
  protected async updateInShopify(shopifyId: string, item: SourceItem): Promise<void> {
    // Catalogs have limited update capabilities
    // For now, just log that an update was requested
    this.log.debug(`Catalog update requested for ${shopifyId} - limited update support`);
  }

  /**
   * Update the Shopify ID in the source sheet
   */
  protected async updateSourceShopifyId(rowIndex: number, shopifyId: string): Promise<void> {
    await updateShopifyId(this.config.sheetName, rowIndex, shopifyId);
  }
}

// Export handler instance
export const catalogsHandler = new CatalogsHandler();
