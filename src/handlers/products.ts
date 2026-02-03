/**
 * Products Handler
 * Syncs products from Google Sheets (ERP) to Shopify
 */

import { ToShopifyHandler, type SourceItem } from './base';
import { sheetsClient } from '../integrations/googleSheets/client';
import { updateShopifyId } from '../integrations/googleSheets/operations';
import { 
  createProduct, 
  updateProduct, 
  createProductVariant,
  getProductBySku,
  type ShopifyProduct 
} from '../integrations/shopify/queries';
import { shopifyClient } from '../integrations/shopify/client';
import { ERP_METAFIELD_NAMESPACE, ERP_METAFIELD_KEY } from '../utils/idMapping';

/**
 * Product row from Google Sheets
 */
interface ProductRow extends SourceItem {
  sku: string;
  title: string;
  description?: string;
  vendor?: string;
  product_type?: string;
  tags?: string;
  status?: string;
  price?: string;
}

/**
 * Products Handler class
 */
export class ProductsHandler extends ToShopifyHandler {
  constructor() {
    super('products');
  }

  /**
   * Read products from Google Sheets
   */
  protected async readSourceItems(): Promise<ProductRow[]> {
    const sheetName = this.config.sheetName;
    const rows = await sheetsClient.readAll(sheetName);

    return rows.map(row => ({
      sku: row.values.sku || '',
      title: row.values.title || '',
      description: row.values.description || row.values.descriptionhtml || '',
      vendor: row.values.vendor || '',
      product_type: row.values.product_type || row.values.producttype || '',
      tags: row.values.tags || '',
      status: row.values.status || 'active',
      price: row.values.price || '0.00',
      shopify_id: row.values.shopify_id || '',
      _rowIndex: row.rowIndex,
    }));
  }

  /**
   * Create a product in Shopify
   */
  protected async createInShopify(item: SourceItem): Promise<string> {
    const productRow = item as ProductRow;

    // Check if product already exists by SKU (for adopt behavior)
    if (this.getExistingDataBehavior() !== 'ignore') {
      const existing = await getProductBySku(productRow.sku);
      if (existing) {
        // Adopt this product
        await this.createIdMapping(productRow.sku, existing.id);
        
        // Set external ID metafield
        await shopifyClient.setMetafield(
          existing.id,
          ERP_METAFIELD_NAMESPACE,
          ERP_METAFIELD_KEY,
          productRow.sku
        );

        return existing.id;
      }
    }

    // Create the product
    const product = await createProduct({
      title: productRow.title,
      descriptionHtml: productRow.description ? `<p>${productRow.description}</p>` : undefined,
      vendor: productRow.vendor || undefined,
      productType: productRow.product_type || undefined,
      tags: productRow.tags ? productRow.tags.split(',').map(t => t.trim()) : undefined,
      status: this.mapStatus(productRow.status),
    });

    // Create variant with SKU and price
    if (productRow.sku) {
      await createProductVariant(product.id, {
        sku: productRow.sku,
        price: productRow.price || '0.00',
      });
    }

    // Set external ID metafield
    await shopifyClient.setMetafield(
      product.id,
      ERP_METAFIELD_NAMESPACE,
      ERP_METAFIELD_KEY,
      productRow.sku
    );

    return product.id;
  }

  /**
   * Update a product in Shopify
   */
  protected async updateInShopify(shopifyId: string, item: SourceItem): Promise<void> {
    const productRow = item as ProductRow;

    await updateProduct(shopifyId, {
      title: productRow.title,
      descriptionHtml: productRow.description ? `<p>${productRow.description}</p>` : undefined,
      vendor: productRow.vendor || undefined,
      productType: productRow.product_type || undefined,
      tags: productRow.tags ? productRow.tags.split(',').map(t => t.trim()) : undefined,
      status: this.mapStatus(productRow.status),
    });
  }

  /**
   * Update the Shopify ID in the source sheet
   */
  protected async updateSourceShopifyId(rowIndex: number, shopifyId: string): Promise<void> {
    await updateShopifyId(this.config.sheetName, rowIndex, shopifyId);
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
