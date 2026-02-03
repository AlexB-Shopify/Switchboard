/**
 * Inventory Handler
 * Syncs inventory levels from Google Sheets (ERP) to Shopify
 * Depends on Products handler (products must be synced first)
 */

import { BaseHandler, type SyncStats, type ItemResult } from './base';
import { sheetsClient } from '../integrations/googleSheets/client';
import { shopifyClient } from '../integrations/shopify/client';
import { 
  getProducts, 
  setInventoryQuantity,
  type ShopifyProduct,
  type ShopifyVariant 
} from '../integrations/shopify/queries';
import { lookupByExternalId } from '../utils/idMapping';

/**
 * Inventory row from Google Sheets
 */
interface InventoryRow {
  sku: string;
  location?: string;
  quantity: string;
  shopify_id?: string;
  _rowIndex: number;
}

/**
 * Inventory Handler class
 */
export class InventoryHandler extends BaseHandler {
  private locationCache: Map<string, string> = new Map();
  private primaryLocationId: string | null = null;

  constructor() {
    super('inventory');
  }

  /**
   * Perform the sync operation
   */
  protected async sync(): Promise<SyncStats> {
    // Get locations
    await this.loadLocations();

    // Read inventory items from source
    const inventoryItems = await this.readSourceItems();
    this.log.debug(`Read ${inventoryItems.length} inventory items from source`);

    // Build a map of SKU -> inventory item ID for quick lookups
    const skuToInventoryItem = await this.buildSkuToInventoryItemMap();
    this.log.debug(`Loaded ${skuToInventoryItem.size} SKU mappings from Shopify`);

    // Process each inventory item
    return this.processBatch(inventoryItems, async (item) => {
      return this.processInventoryItem(item, skuToInventoryItem);
    });
  }

  /**
   * Read inventory items from Google Sheets
   */
  private async readSourceItems(): Promise<InventoryRow[]> {
    const sheetName = this.config.sheetName;
    const rows = await sheetsClient.readAll(sheetName);

    return rows.map(row => ({
      sku: row.values.sku || '',
      location: row.values.location || '',
      quantity: row.values.quantity || '0',
      shopify_id: row.values.shopify_id || '',
      _rowIndex: row.rowIndex,
    }));
  }

  /**
   * Load locations from Shopify
   */
  private async loadLocations(): Promise<void> {
    const locations = await shopifyClient.getLocations();
    
    this.locationCache.clear();
    for (const loc of locations) {
      this.locationCache.set(loc.name.toLowerCase(), loc.id);
      if (loc.isActive && !this.primaryLocationId) {
        this.primaryLocationId = loc.id;
      }
    }

    if (!this.primaryLocationId && locations.length > 0) {
      this.primaryLocationId = locations[0].id;
    }

    this.log.debug(`Loaded ${locations.length} locations`);
  }

  /**
   * Get location ID by name or return primary location
   */
  private getLocationId(locationName?: string): string {
    if (locationName) {
      const id = this.locationCache.get(locationName.toLowerCase());
      if (id) return id;
    }

    // Check for default location from config
    const settings = this.config.settings as { defaultLocationName?: string } | undefined;
    if (settings?.defaultLocationName) {
      const id = this.locationCache.get(settings.defaultLocationName.toLowerCase());
      if (id) return id;
    }

    // Fall back to primary location
    if (!this.primaryLocationId) {
      throw new Error('No location found');
    }
    return this.primaryLocationId;
  }

  /**
   * Build a map of SKU -> inventory item ID
   */
  private async buildSkuToInventoryItemMap(): Promise<Map<string, { inventoryItemId: string; variantId: string; productId: string }>> {
    const map = new Map<string, { inventoryItemId: string; variantId: string; productId: string }>();
    let hasMore = true;
    let cursor: string | undefined;

    while (hasMore) {
      const { products, pageInfo } = await getProducts(50, cursor);

      for (const product of products) {
        for (const edge of product.variants.edges) {
          const variant = edge.node;
          if (variant.sku) {
            map.set(variant.sku, {
              inventoryItemId: variant.inventoryItem.id,
              variantId: variant.id,
              productId: product.id,
            });
          }
        }
      }

      hasMore = pageInfo.hasNextPage;
      cursor = pageInfo.endCursor;
    }

    return map;
  }

  /**
   * Process a single inventory item
   */
  private async processInventoryItem(
    item: InventoryRow,
    skuMap: Map<string, { inventoryItemId: string; variantId: string; productId: string }>
  ): Promise<ItemResult> {
    const { sku, quantity, location } = item;

    if (!sku) {
      return this.failureResult('unknown', 'Missing SKU');
    }

    // Look up the inventory item ID
    const inventoryInfo = skuMap.get(sku);
    
    if (!inventoryInfo) {
      // Check if the product exists in our mappings but not in Shopify
      const productMapping = await lookupByExternalId('products', sku);
      
      if (productMapping.found) {
        return this.failureResult(sku, 'Product mapped but variant not found - may need resync');
      }
      
      return this.failureResult(sku, 'SKU not found in Shopify - sync products first');
    }

    try {
      const locationId = this.getLocationId(location);
      const qty = parseInt(quantity, 10) || 0;

      await setInventoryQuantity(
        inventoryInfo.inventoryItemId,
        locationId,
        qty
      );

      return this.successResult('updated', sku, inventoryInfo.inventoryItemId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return this.failureResult(sku, errorMessage);
    }
  }
}

// Export handler instance
export const inventoryHandler = new InventoryHandler();
