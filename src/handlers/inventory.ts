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
 * Inventory row from Google Sheets
 * Supports both Shopify export format and simplified ERP format
 */
interface InventoryRow {
  // Product/Variant identification
  handle: string;
  title?: string;        // Product title (Shopify export)
  sku: string;
  
  // Option columns for variant matching
  option1_name?: string;
  option1_value: string;
  option2_name?: string;
  option2_value?: string;
  option3_name?: string;
  option3_value?: string;
  
  // Location
  location?: string;
  bin_name?: string;
  
  // Quantities
  quantity: string;           // The quantity to set (uses "On hand (new)" from exports)
  on_hand_current?: string;   // Current on-hand (read-only in exports)
  available?: string;         // Available quantity (read-only in exports)
  committed?: string;         // Committed quantity (read-only in exports)
  incoming?: string;          // Incoming quantity (read-only in exports)
  unavailable?: string;       // Unavailable quantity (read-only in exports)
  
  // Additional fields
  hs_code?: string;           // Harmonized System code
  coo?: string;               // Country of Origin
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

    // Build maps for variant lookups
    const lookupMaps = await this.buildVariantLookupMaps();
    this.log.debug(`Loaded ${lookupMaps.bySku.size} SKU mappings, ${lookupMaps.byHandleOption.size} handle+option mappings from Shopify`);

    // Process each inventory item
    return this.processBatch(inventoryItems, async (item) => {
      return this.processInventoryItem(item, lookupMaps);
    });
  }

  /**
   * Read inventory items from Google Sheets
   * Supports both Shopify export format and simplified ERP format
   */
  private async readSourceItems(): Promise<InventoryRow[]> {
    const sheetName = this.config.sheetName;
    const rows = await sheetsClient.readAll(sheetName);

    return rows.map((row, idx) => {
      const v = row.values;
      
      // Debug: log first few rows to see what columns we're getting
      if (idx < 3) {
        this.log.debug(`Row ${idx} columns: ${Object.keys(v).join(', ')}`);
        this.log.debug(`Row ${idx} quantity fields: "On hand (new)"="${v['On hand (new)']}", quantity="${v['quantity']}"`);
      }
      
      return {
        // Handle - primary identifier in Shopify exports
        handle: getColumn(v, 'handle', 'Handle'),
        // Title - product name (Shopify export)
        title: getColumn(v, 'title', 'Title'),
        // SKU - may be empty in Shopify exports
        sku: getColumn(v, 'sku', 'SKU', 'Variant SKU'),
        
        // Option columns for variant matching
        option1_name: getColumn(v, 'option1_name', 'Option1 Name'),
        option1_value: getColumn(v, 'option1_value', 'Option1 Value', 'option_value', 'variant'),
        option2_name: getColumn(v, 'option2_name', 'Option2 Name'),
        option2_value: getColumn(v, 'option2_value', 'Option2 Value'),
        option3_name: getColumn(v, 'option3_name', 'Option3 Name'),
        option3_value: getColumn(v, 'option3_value', 'Option3 Value'),
        
        // Location
        location: getColumn(v, 'location', 'Location'),
        bin_name: getColumn(v, 'bin_name', 'Bin name', 'Bin Name'),
        
        // Quantities - prefer explicit "quantity" or filled-in "On hand (new)", 
        // but fall back to "available" if those are empty/zero
        quantity: (() => {
          // First try explicit quantity column (ERP format)
          const explicit = getColumn(v, 'quantity');
          if (explicit && explicit !== '0') return explicit;
          
          // Then try "On hand (new)" - the Shopify import column
          const onHandNew = getColumn(v, 'On hand (new)', 'onhandnew');
          if (onHandNew && onHandNew !== '0') return onHandNew;
          
          // Fall back to available inventory (current stock)
          const available = getColumn(v, 'available', 'Available', 'on_hand', 'on hand');
          if (available) return available;
          
          // Last resort - use the "On hand (new)" even if 0
          return onHandNew || '0';
        })(),
        on_hand_current: getColumn(v, 'on_hand_current', 'On hand (current)', 'onhandcurrent'),
        available: getColumn(v, 'available', 'Available (not editable)', 'availablenoteditable'),
        committed: getColumn(v, 'committed', 'Committed (not editable)', 'committednoteditable'),
        incoming: getColumn(v, 'incoming', 'Incoming (not editable)', 'incomingnoteditable'),
        unavailable: getColumn(v, 'unavailable', 'Unavailable (not editable)', 'unavailablenoteditable'),
        
        // Additional fields
        hs_code: getColumn(v, 'hs_code', 'HS Code', 'hscode'),
        coo: getColumn(v, 'coo', 'COO', 'country_of_origin'),
        shopify_id: getColumn(v, 'shopify_id'),
        _rowIndex: row.rowIndex,
      };
    });
  }

  /**
   * Load locations from Shopify
   */
  private async loadLocations(): Promise<void> {
    const locations = await shopifyClient.getLocations();
    
    this.locationCache.clear();
    for (const loc of locations) {
      this.locationCache.set(loc.name.toLowerCase(), loc.id);
      this.log.debug(`Location: "${loc.name}" -> ${loc.id} (active: ${loc.isActive})`);
      if (loc.isActive && !this.primaryLocationId) {
        this.primaryLocationId = loc.id;
      }
    }

    if (!this.primaryLocationId && locations.length > 0) {
      this.primaryLocationId = locations[0].id;
    }

    this.log.debug(`Loaded ${locations.length} locations, primary: ${this.primaryLocationId}`);
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
   * Build lookup maps for variants (by SKU and by handle+option)
   */
  private async buildVariantLookupMaps(): Promise<{
    bySku: Map<string, { inventoryItemId: string; variantId: string; productId: string }>;
    byHandleOption: Map<string, { inventoryItemId: string; variantId: string; productId: string }>;
  }> {
    const bySku = new Map<string, { inventoryItemId: string; variantId: string; productId: string }>();
    const byHandleOption = new Map<string, { inventoryItemId: string; variantId: string; productId: string }>();
    
    let hasMore = true;
    let cursor: string | undefined;

    while (hasMore) {
      const { products, pageInfo } = await getProducts(50, cursor);

      for (const product of products) {
        for (const edge of product.variants.edges) {
          const variant = edge.node;
          const info = {
            inventoryItemId: variant.inventoryItem.id,
            variantId: variant.id,
            productId: product.id,
          };

          // Map by SKU (if present)
          if (variant.sku) {
            bySku.set(variant.sku, info);
          }

          // Map by handle + variant title (option value)
          // Variant title is typically "Default Title" or the option value like "Small" or "Red"
          const key = `${product.handle}|${variant.title}`.toLowerCase();
          byHandleOption.set(key, info);
          
          // Also map by handle alone for single-variant products
          if (variant.title === 'Default Title' || product.variants.edges.length === 1) {
            byHandleOption.set(product.handle.toLowerCase(), info);
          }
        }
      }

      hasMore = pageInfo.hasNextPage;
      cursor = pageInfo.endCursor;
    }

    return { bySku, byHandleOption };
  }

  /**
   * Process a single inventory item
   */
  private async processInventoryItem(
    item: InventoryRow,
    lookupMaps: {
      bySku: Map<string, { inventoryItemId: string; variantId: string; productId: string }>;
      byHandleOption: Map<string, { inventoryItemId: string; variantId: string; productId: string }>;
    }
  ): Promise<ItemResult> {
    const { handle, sku, option1_value, quantity, location } = item;
    
    // Determine identifier for logging
    const identifier = sku || (handle && option1_value ? `${handle}/${option1_value}` : handle) || 'unknown';

    if (!sku && !handle) {
      return this.failureResult('unknown', 'Missing both SKU and Handle');
    }

    // Look up the inventory item ID
    let inventoryInfo: { inventoryItemId: string; variantId: string; productId: string } | undefined;
    
    // Try SKU first (most precise)
    if (sku) {
      inventoryInfo = lookupMaps.bySku.get(sku);
    }
    
    // Try handle + option value if SKU didn't match
    if (!inventoryInfo && handle) {
      if (option1_value) {
        const key = `${handle}|${option1_value}`.toLowerCase();
        inventoryInfo = lookupMaps.byHandleOption.get(key);
      }
      // Fall back to just handle (for single-variant products)
      if (!inventoryInfo) {
        inventoryInfo = lookupMaps.byHandleOption.get(handle.toLowerCase());
      }
    }
    
    if (!inventoryInfo) {
      // Check if the product exists in our mappings but not in Shopify
      const productMapping = await lookupByExternalId('products', handle || sku);
      
      if (productMapping.found) {
        return this.failureResult(identifier, 'Product mapped but variant not found - may need resync');
      }
      
      return this.failureResult(identifier, 'Variant not found in Shopify - sync products first');
    }

    try {
      const locationId = this.getLocationId(location);
      const qty = parseInt(quantity, 10) || 0;

      this.log.debug(`Inventory update: ${identifier} -> location="${location || '(default)'}" (${locationId}), qty=${qty} (raw: "${quantity}")`);
      
      if (qty === 0 && quantity !== '0' && quantity !== '') {
        this.log.warn(`Warning: quantity "${quantity}" parsed to 0 - check column format`);
      }

      await setInventoryQuantity(
        inventoryInfo.inventoryItemId,
        locationId,
        qty
      );

      return this.successResult('updated', identifier, inventoryInfo.inventoryItemId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return this.failureResult(identifier, errorMessage);
    }
  }
}

// Export handler instance
export const inventoryHandler = new InventoryHandler();
