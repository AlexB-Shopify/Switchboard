/**
 * Products Handler
 * Syncs products from Google Sheets (ERP) to Shopify
 * Supports multi-variant products where each variant is a separate row
 */

import { ToShopifyHandler, type SourceItem } from './base';
import { sheetsClient } from '../integrations/googleSheets/client';
import { updateShopifyId } from '../integrations/googleSheets/operations';
import { 
  createProduct, 
  updateProduct, 
  createProductVariant,
  getProductBySku,
  getProducts,
  type ShopifyProduct 
} from '../integrations/shopify/queries';
import { shopifyClient } from '../integrations/shopify/client';
import { ERP_METAFIELD_NAMESPACE, ERP_METAFIELD_KEY } from '../utils/idMapping';

/**
 * Raw row from Google Sheets (one per variant)
 */
interface ProductVariantRow extends SourceItem {
  handle: string;
  sku: string;
  title: string;
  description?: string;
  vendor?: string;
  product_type?: string;
  tags?: string;
  status?: string;
  published?: string;
  // Option columns
  option1_name?: string;
  option1_value?: string;
  option2_name?: string;
  option2_value?: string;
  option3_name?: string;
  option3_value?: string;
  // Variant-specific
  price?: string;
  compare_at_price?: string;
  image_url?: string;
  variant_image?: string;
  weight?: string;
  weight_unit?: string;
  inventory_qty?: string;
  barcode?: string;
}

/**
 * Grouped product with all its variants
 */
interface GroupedProduct {
  handle: string;
  title: string;
  description?: string;
  vendor?: string;
  product_type?: string;
  tags?: string;
  status?: string;
  image_url?: string;
  // Option definitions
  option1_name?: string;
  option2_name?: string;
  option3_name?: string;
  // All variant rows
  variants: ProductVariantRow[];
  // First row index (for writing back shopify_id)
  firstRowIndex: number;
}

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
 * Products Handler class
 */
export class ProductsHandler extends ToShopifyHandler {
  constructor() {
    super('products');
  }

  /**
   * Read and group products from Google Sheets
   * Groups rows by Handle to support multi-variant products
   */
  protected async readSourceItems(): Promise<SourceItem[]> {
    const sheetName = this.config.sheetName;
    const rows = await sheetsClient.readAll(sheetName);

    // Parse each row into a variant row
    const variantRows: ProductVariantRow[] = rows.map(row => {
      const v = row.values;
      return {
        handle: getColumn(v, 'handle', 'Handle'),
        sku: getColumn(v, 'sku', 'Variant SKU', 'variant_sku'),
        title: getColumn(v, 'title', 'Title'),
        description: getColumn(v, 'description', 'descriptionhtml', 'Body (HTML)', 'body_html', 'body'),
        vendor: getColumn(v, 'vendor', 'Vendor'),
        product_type: getColumn(v, 'product_type', 'producttype', 'Type'),
        tags: getColumn(v, 'tags', 'Tags'),
        status: getColumn(v, 'status', 'Status') || 'active',
        published: getColumn(v, 'published', 'Published'),
        // Options
        option1_name: getColumn(v, 'option1_name', 'Option1 Name', 'option1name'),
        option1_value: getColumn(v, 'option1_value', 'Option1 Value', 'option1value'),
        option2_name: getColumn(v, 'option2_name', 'Option2 Name', 'option2name'),
        option2_value: getColumn(v, 'option2_value', 'Option2 Value', 'option2value'),
        option3_name: getColumn(v, 'option3_name', 'Option3 Name', 'option3name'),
        option3_value: getColumn(v, 'option3_value', 'Option3 Value', 'option3value'),
        // Variant specifics
        price: getColumn(v, 'price', 'Variant Price', 'variant_price') || '0.00',
        compare_at_price: getColumn(v, 'compare_at_price', 'Variant Compare At Price', 'compareAtPrice'),
        image_url: getColumn(v, 'image_url', 'Image Src', 'image_src', 'image'),
        variant_image: getColumn(v, 'variant_image', 'Variant Image'),
        weight: getColumn(v, 'weight', 'Variant Grams', 'variant_grams'),
        weight_unit: getColumn(v, 'weight_unit', 'Variant Weight Unit'),
        inventory_qty: getColumn(v, 'inventory_qty', 'Variant Inventory Qty', 'variant_inventory_qty'),
        barcode: getColumn(v, 'barcode', 'Variant Barcode'),
        shopify_id: getColumn(v, 'shopify_id'),
        _rowIndex: row.rowIndex,
      };
    });

    // Group rows by handle
    const grouped = this.groupByHandle(variantRows);
    
    // Convert to array and return as SourceItem[]
    return Array.from(grouped.values()) as unknown as SourceItem[];
  }

  /**
   * Group variant rows by handle into products
   */
  private groupByHandle(rows: ProductVariantRow[]): Map<string, GroupedProduct> {
    const products = new Map<string, GroupedProduct>();

    for (const row of rows) {
      if (!row.handle) continue;

      if (!products.has(row.handle)) {
        // First row for this handle - use product-level data
        products.set(row.handle, {
          handle: row.handle,
          title: row.title,
          description: row.description,
          vendor: row.vendor,
          product_type: row.product_type,
          tags: row.tags,
          status: row.status,
          image_url: row.image_url,
          option1_name: row.option1_name,
          option2_name: row.option2_name,
          option3_name: row.option3_name,
          variants: [row],
          firstRowIndex: row._rowIndex,
        });
      } else {
        // Additional variant row
        const product = products.get(row.handle)!;
        product.variants.push(row);
        
        // Update option names if they're defined in this row but not the first
        if (row.option1_name && !product.option1_name) {
          product.option1_name = row.option1_name;
        }
        if (row.option2_name && !product.option2_name) {
          product.option2_name = row.option2_name;
        }
        if (row.option3_name && !product.option3_name) {
          product.option3_name = row.option3_name;
        }
      }
    }

    return products;
  }

  /**
   * Create a product with variants in Shopify
   */
  protected async createInShopify(item: SourceItem): Promise<string> {
    const groupedProduct = item as unknown as GroupedProduct;
    const externalId = groupedProduct.handle;

    // Check if product already exists (for adopt behavior)
    if (this.getExistingDataBehavior() !== 'ignore') {
      const existing = await this.findProductByHandle(groupedProduct.handle);
      
      if (existing) {
        // Adopt this product
        await this.createIdMapping(externalId, existing.id);
        
        // Set external ID metafield
        await shopifyClient.setMetafield(
          existing.id,
          ERP_METAFIELD_NAMESPACE,
          ERP_METAFIELD_KEY,
          externalId
        );

        return existing.id;
      }
    }

    // Build options array from option names
    const options: string[] = [];
    if (groupedProduct.option1_name && groupedProduct.option1_name !== 'Title') {
      options.push(groupedProduct.option1_name);
    }
    if (groupedProduct.option2_name) {
      options.push(groupedProduct.option2_name);
    }
    if (groupedProduct.option3_name) {
      options.push(groupedProduct.option3_name);
    }

    // Build product input
    const productInput: {
      title: string;
      handle?: string;
      descriptionHtml?: string;
      vendor?: string;
      productType?: string;
      tags?: string[];
      status?: 'ACTIVE' | 'ARCHIVED' | 'DRAFT';
      options?: string[];
      images?: Array<{ src: string; altText?: string }>;
    } = {
      title: groupedProduct.title,
      handle: groupedProduct.handle,
      descriptionHtml: groupedProduct.description 
        ? (groupedProduct.description.startsWith('<') ? groupedProduct.description : `<p>${groupedProduct.description}</p>`)
        : undefined,
      vendor: groupedProduct.vendor || undefined,
      productType: groupedProduct.product_type || undefined,
      tags: groupedProduct.tags ? groupedProduct.tags.split(',').map(t => t.trim()) : undefined,
      status: this.mapStatus(groupedProduct.status),
    };

    // Add options if we have any
    if (options.length > 0) {
      productInput.options = options;
    }

    // Add product image if URL provided
    if (groupedProduct.image_url) {
      productInput.images = [{ src: groupedProduct.image_url }];
    }

    // Create the product (with default variant)
    const product = await createProduct(productInput);

    // If we have multiple variants or specific variant data, create/update variants
    if (groupedProduct.variants.length > 0) {
      // For multi-variant products, we need to create each variant
      // Note: Shopify creates a default variant, so we update/create as needed
      for (let i = 0; i < groupedProduct.variants.length; i++) {
        const variantRow = groupedProduct.variants[i];
        
        // Build option values
        const optionValues: string[] = [];
        if (variantRow.option1_value) optionValues.push(variantRow.option1_value);
        if (variantRow.option2_value) optionValues.push(variantRow.option2_value);
        if (variantRow.option3_value) optionValues.push(variantRow.option3_value);

        // Skip if this is just a "Default Title" single variant and it's the first one
        if (i === 0 && optionValues.length === 0 && groupedProduct.variants.length === 1) {
          // Just update the default variant with SKU/price
          const defaultVariant = product.variants.edges[0]?.node;
          if (defaultVariant && (variantRow.sku || variantRow.price)) {
            // Would need a variant update mutation - for now we use bulk create
          }
          continue;
        }

        try {
          await createProductVariant(product.id, {
            sku: variantRow.sku || '',
            price: variantRow.price || '0.00',
            options: optionValues.length > 0 ? optionValues : undefined,
            barcode: variantRow.barcode || undefined,
            weight: variantRow.weight ? parseFloat(variantRow.weight) : undefined,
            weightUnit: (variantRow.weight_unit?.toUpperCase() || 'GRAMS') as 'GRAMS' | 'KILOGRAMS' | 'OUNCES' | 'POUNDS',
          });
        } catch (error) {
          // Variant might already exist, log and continue
          this.log.debug(`Could not create variant for ${groupedProduct.handle}: ${error}`);
        }
      }
    }

    // Set external ID metafield
    await shopifyClient.setMetafield(
      product.id,
      ERP_METAFIELD_NAMESPACE,
      ERP_METAFIELD_KEY,
      externalId
    );

    return product.id;
  }

  /**
   * Find a product by handle
   */
  private async findProductByHandle(handle: string): Promise<ShopifyProduct | null> {
    if (!handle) return null;
    // Use the products query with handle filter
    const query = `handle:${handle}`;
    return getProductBySku(query); // Reuses the query function
  }

  /**
   * Update a product in Shopify
   */
  protected async updateInShopify(shopifyId: string, item: SourceItem): Promise<void> {
    const groupedProduct = item as unknown as GroupedProduct;

    await updateProduct(shopifyId, {
      title: groupedProduct.title,
      descriptionHtml: groupedProduct.description 
        ? (groupedProduct.description.startsWith('<') ? groupedProduct.description : `<p>${groupedProduct.description}</p>`)
        : undefined,
      vendor: groupedProduct.vendor || undefined,
      productType: groupedProduct.product_type || undefined,
      tags: groupedProduct.tags ? groupedProduct.tags.split(',').map(t => t.trim()) : undefined,
      status: this.mapStatus(groupedProduct.status),
    });
    
    // Note: Variant updates would require additional logic to match existing variants
    // For now, we only update product-level data
  }

  /**
   * Update the Shopify ID in the source sheet
   */
  protected async updateSourceShopifyId(rowIndex: number, shopifyId: string): Promise<void> {
    await updateShopifyId(this.config.sheetName, rowIndex, shopifyId);
  }

  /**
   * Override getExternalIdField to use handle for grouped products
   */
  protected getExternalIdField(): string {
    return 'handle';
  }

  /**
   * Map status string to Shopify enum
   */
  private mapStatus(status?: string): 'ACTIVE' | 'ARCHIVED' | 'DRAFT' {
    switch (status?.toLowerCase()) {
      case 'active':
        return 'ACTIVE';
      case 'archived':
        return 'ARCHIVED';
      case 'draft':
        return 'DRAFT';
      default:
        return 'ACTIVE';
    }
  }
}

// Export handler instance
export const productsHandler = new ProductsHandler();
