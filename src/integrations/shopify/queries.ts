/**
 * Shopify GraphQL Queries and Mutations
 * Organized by data object type
 */

import { shopifyClient, type UserError, type Connection } from './client';
import { logger } from '../../core/logger';

// ============ Common Types ============

export interface ShopifyProduct {
  id: string;
  title: string;
  handle: string;
  descriptionHtml: string;
  vendor: string;
  productType: string;
  tags: string[];
  status: 'ACTIVE' | 'ARCHIVED' | 'DRAFT';
  variants: Connection<ShopifyVariant>;
  metafields: Connection<{ namespace: string; key: string; value: string }>;
}

export interface ShopifyVariant {
  id: string;
  sku: string;
  title: string;
  price: string;
  inventoryItem: { id: string };
  inventoryQuantity: number;
}

export interface ShopifyInventoryLevel {
  id: string;
  available: number;
  item: { id: string; sku: string };
  location: { id: string; name: string };
}

export interface ShopifyOrder {
  id: string;
  name: string;
  email: string;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  displayFinancialStatus: string;
  displayFulfillmentStatus: string;
  createdAt: string;
  lineItems: Connection<{
    id: string;
    title: string;
    quantity: number;
    sku: string;
  }>;
  customer: { id: string; email: string; firstName: string; lastName: string } | null;
}

export interface ShopifyFulfillment {
  id: string;
  status: string;
  trackingInfo: Array<{ number: string; company: string; url: string }>;
}

export interface ShopifyCustomer {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  addresses: Connection<{
    id: string;
    address1: string;
    city: string;
    province: string;
    country: string;
    zip: string;
  }>;
}

// ============ Products ============

export async function getProducts(first: number = 50, after?: string): Promise<{
  products: ShopifyProduct[];
  pageInfo: { hasNextPage: boolean; endCursor?: string };
}> {
  const query = `
    query GetProducts($first: Int!, $after: String) {
      products(first: $first, after: $after) {
        edges {
          node {
            id
            title
            handle
            descriptionHtml
            vendor
            productType
            tags
            status
            variants(first: 100) {
              edges {
                node {
                  id
                  sku
                  title
                  price
                  inventoryItem { id }
                  inventoryQuantity
                }
              }
            }
            metafields(first: 10, namespace: "custom") {
              edges {
                node {
                  namespace
                  key
                  value
                }
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  const data = await shopifyClient.graphql<{
    products: {
      edges: Array<{ node: ShopifyProduct }>;
      pageInfo: { hasNextPage: boolean; endCursor?: string };
    };
  }>(query, { first, after });

  return {
    products: data.products.edges.map(e => e.node),
    pageInfo: data.products.pageInfo,
  };
}

export async function getProductBySku(sku: string): Promise<ShopifyProduct | null> {
  const query = `
    query GetProductBySku($query: String!) {
      products(first: 1, query: $query) {
        edges {
          node {
            id
            title
            handle
            descriptionHtml
            vendor
            productType
            tags
            status
            variants(first: 100) {
              edges {
                node {
                  id
                  sku
                  title
                  price
                  inventoryItem { id }
                  inventoryQuantity
                }
              }
            }
            metafields(first: 10, namespace: "custom") {
              edges {
                node {
                  namespace
                  key
                  value
                }
              }
            }
          }
        }
      }
    }
  `;

  const data = await shopifyClient.graphql<{
    products: { edges: Array<{ node: ShopifyProduct }> };
  }>(query, { query: `sku:${sku}` });

  return data.products.edges[0]?.node ?? null;
}

export async function createProduct(input: {
  title: string;
  handle?: string;
  descriptionHtml?: string;
  vendor?: string;
  productType?: string;
  tags?: string[];
  status?: 'ACTIVE' | 'ARCHIVED' | 'DRAFT';
  options?: string[];  // Option names like "Color", "Size" - handled separately in 2026-01+
  images?: Array<{ src: string; altText?: string }>;  // Handled separately via media API
}): Promise<ShopifyProduct> {
  // Extract options and images - they're handled separately in newer API versions
  const { options, images, ...productInput } = input;
  
  const mutation = `
    mutation CreateProduct($input: ProductInput!, $media: [CreateMediaInput!]) {
      productCreate(input: $input, media: $media) {
        product {
          id
          title
          handle
          descriptionHtml
          vendor
          productType
          tags
          status
          variants(first: 100) {
            edges {
              node {
                id
                sku
                title
                price
                inventoryItem { id }
                inventoryQuantity
              }
            }
          }
          metafields(first: 10, namespace: "custom") {
            edges {
              node {
                namespace
                key
                value
              }
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  // Convert images to media input format for 2026-01 API
  const media = images?.map(img => ({
    originalSource: img.src,
    alt: img.altText || '',
    mediaContentType: 'IMAGE' as const,
  }));

  const data = await shopifyClient.graphql<{
    productCreate: { product: ShopifyProduct | null; userErrors: UserError[] };
  }>(mutation, { 
    input: productInput,
    media: media && media.length > 0 ? media : undefined,
  });

  shopifyClient.checkUserErrors(data.productCreate.userErrors, 'createProduct');
  
  // If options were provided, add them to the product
  if (options && options.length > 0 && data.productCreate.product) {
    await addProductOptions(data.productCreate.product.id, options);
  }
  
  return data.productCreate.product!;
}

/**
 * Add options to a product (for 2026-01+ API)
 */
async function addProductOptions(productId: string, optionNames: string[]): Promise<void> {
  const mutation = `
    mutation ProductOptionsCreate($productId: ID!, $options: [OptionCreateInput!]!) {
      productOptionsCreate(productId: $productId, options: $options) {
        userErrors {
          field
          message
        }
      }
    }
  `;

  const options = optionNames.map(name => ({
    name,
    values: [{ name: 'Default' }],  // Initial value, will be updated when variants are created
  }));

  const data = await shopifyClient.graphql<{
    productOptionsCreate: { userErrors: UserError[] };
  }>(mutation, { productId, options });

  shopifyClient.checkUserErrors(data.productOptionsCreate.userErrors, 'addProductOptions');
}

export async function updateProduct(
  id: string,
  input: {
    title?: string;
    descriptionHtml?: string;
    vendor?: string;
    productType?: string;
    tags?: string[];
    status?: 'ACTIVE' | 'ARCHIVED' | 'DRAFT';
  }
): Promise<ShopifyProduct> {
  const mutation = `
    mutation UpdateProduct($input: ProductInput!) {
      productUpdate(input: $input) {
        product {
          id
          title
          handle
          descriptionHtml
          vendor
          productType
          tags
          status
          variants(first: 100) {
            edges {
              node {
                id
                sku
                title
                price
                inventoryItem { id }
                inventoryQuantity
              }
            }
          }
          metafields(first: 10, namespace: "custom") {
            edges {
              node {
                namespace
                key
                value
              }
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const data = await shopifyClient.graphql<{
    productUpdate: { product: ShopifyProduct | null; userErrors: UserError[] };
  }>(mutation, { input: { id, ...input } });

  shopifyClient.checkUserErrors(data.productUpdate.userErrors, 'updateProduct');
  return data.productUpdate.product!;
}

export async function createProductVariant(
  productId: string,
  input: {
    sku?: string;
    price?: string;
    title?: string;
    optionValues?: Array<{ optionName: string; value: string }>;  // Option name + value pairs
    barcode?: string;
    weight?: number;  // Note: weight is set via inventoryItem in 2026-01+
    weightUnit?: 'GRAMS' | 'KILOGRAMS' | 'OUNCES' | 'POUNDS';
    compareAtPrice?: string;
  }
): Promise<ShopifyVariant> {
  const mutation = `
    mutation CreateProductVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkCreate(productId: $productId, variants: $variants) {
        productVariants {
          id
          sku
          title
          price
          inventoryItem { id }
          inventoryQuantity
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  // Build variant input - note: weight/weightUnit not supported in ProductVariantsBulkInput for 2026-01+
  // Weight must be set via inventoryItem update separately
  const variantInput: {
    sku?: string;
    price?: string;
    optionValues?: Array<{ optionName: string; name: string }>;
    barcode?: string;
    compareAtPrice?: string;
  } = {};

  if (input.sku) variantInput.sku = input.sku;
  if (input.price) variantInput.price = input.price;
  if (input.barcode) variantInput.barcode = input.barcode;
  if (input.compareAtPrice) variantInput.compareAtPrice = input.compareAtPrice;

  // Build optionValues array for 2026-01 API
  // Format: [{ optionName: "Color", name: "Cherry" }]
  if (input.optionValues && input.optionValues.length > 0) {
    variantInput.optionValues = input.optionValues.map(ov => ({
      optionName: ov.optionName,
      name: ov.value,
    }));
  }

  const data = await shopifyClient.graphql<{
    productVariantsBulkCreate: {
      productVariants: ShopifyVariant[] | null;
      userErrors: UserError[];
    };
  }>(mutation, {
    productId,
    variants: [variantInput],
  });

  shopifyClient.checkUserErrors(data.productVariantsBulkCreate.userErrors, 'createProductVariant');
  return data.productVariantsBulkCreate.productVariants![0];
}

// ============ Inventory ============

export async function getInventoryLevels(locationId: string, first: number = 50): Promise<{
  levels: ShopifyInventoryLevel[];
  pageInfo: { hasNextPage: boolean; endCursor?: string };
}> {
  const query = `
    query GetInventoryLevels($locationId: ID!, $first: Int!) {
      location(id: $locationId) {
        inventoryLevels(first: $first) {
          edges {
            node {
              id
              available
              item {
                id
                sku
              }
              location {
                id
                name
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  `;

  const data = await shopifyClient.graphql<{
    location: {
      inventoryLevels: {
        edges: Array<{ node: ShopifyInventoryLevel }>;
        pageInfo: { hasNextPage: boolean; endCursor?: string };
      };
    };
  }>(query, { locationId, first });

  return {
    levels: data.location.inventoryLevels.edges.map(e => e.node),
    pageInfo: data.location.inventoryLevels.pageInfo,
  };
}

/**
 * Enable inventory tracking for an inventory item
 */
export async function enableInventoryTracking(
  inventoryItemId: string,
  locationId: string
): Promise<void> {
  // First, enable tracking on the inventory item
  const updateMutation = `
    mutation EnableTracking($id: ID!, $input: InventoryItemInput!) {
      inventoryItemUpdate(id: $id, input: $input) {
        inventoryItem {
          id
          tracked
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const updateData = await shopifyClient.graphql<{
    inventoryItemUpdate: {
      inventoryItem: { id: string; tracked: boolean } | null;
      userErrors: UserError[];
    };
  }>(updateMutation, {
    id: inventoryItemId,
    input: {
      tracked: true,
    },
  });

  shopifyClient.checkUserErrors(updateData.inventoryItemUpdate.userErrors, 'enableInventoryTracking');

  // Then, activate the inventory level at the location
  const activateMutation = `
    mutation ActivateInventory($inventoryItemId: ID!, $locationId: ID!) {
      inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId) {
        inventoryLevel {
          id
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  try {
    const activateData = await shopifyClient.graphql<{
      inventoryActivate: {
        inventoryLevel: { id: string } | null;
        userErrors: UserError[];
      };
    }>(activateMutation, {
      inventoryItemId,
      locationId,
    });

    // Don't throw on activation errors - might already be activated
    if (activateData.inventoryActivate.userErrors.length > 0) {
      const errors = activateData.inventoryActivate.userErrors;
      // Ignore "already stocked" errors
      const realErrors = errors.filter(e => !e.message.includes('already stocked'));
      if (realErrors.length > 0) {
        shopifyClient.checkUserErrors(realErrors, 'activateInventory');
      }
    }
  } catch (error) {
    // Inventory might already be activated - that's okay
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (!errorMessage.includes('already')) {
      throw error;
    }
  }
}

export async function setInventoryQuantity(
  inventoryItemId: string,
  locationId: string,
  quantity: number,
  ensureTracked: boolean = true
): Promise<void> {
  // Optionally ensure inventory tracking is enabled first
  if (ensureTracked) {
    try {
      await enableInventoryTracking(inventoryItemId, locationId);
    } catch (error) {
      // Log but continue - tracking might already be enabled
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!errorMessage.includes('already')) {
        console.warn(`Warning: Could not enable tracking for ${inventoryItemId}: ${errorMessage}`);
      }
    }
  }

  const mutation = `
    mutation SetInventoryQuantity($input: InventorySetOnHandQuantitiesInput!) {
      inventorySetOnHandQuantities(input: $input) {
        inventoryAdjustmentGroup {
          reason
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const data = await shopifyClient.graphql<{
    inventorySetOnHandQuantities: {
      inventoryAdjustmentGroup: { reason: string } | null;
      userErrors: UserError[];
    };
  }>(mutation, {
    input: {
      reason: 'correction',
      setQuantities: [
        {
          inventoryItemId,
          locationId,
          quantity,
        },
      ],
    },
  });

  // Log response for debugging
  if (data.inventorySetOnHandQuantities.userErrors.length > 0) {
    logger.debug(`SetInventoryQuantity userErrors: ${JSON.stringify(data.inventorySetOnHandQuantities.userErrors)}`);
  }
  if (!data.inventorySetOnHandQuantities.inventoryAdjustmentGroup) {
    logger.debug(`SetInventoryQuantity: No adjustment group returned for ${inventoryItemId}`);
  }

  shopifyClient.checkUserErrors(data.inventorySetOnHandQuantities.userErrors, 'setInventoryQuantity');
}

export async function adjustInventoryQuantity(
  inventoryItemId: string,
  locationId: string,
  delta: number
): Promise<void> {
  const mutation = `
    mutation AdjustInventory($input: InventoryAdjustQuantitiesInput!) {
      inventoryAdjustQuantities(input: $input) {
        inventoryAdjustmentGroup {
          reason
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const data = await shopifyClient.graphql<{
    inventoryAdjustQuantities: {
      inventoryAdjustmentGroup: { reason: string } | null;
      userErrors: UserError[];
    };
  }>(mutation, {
    input: {
      reason: 'correction',
      name: 'available',
      changes: [{ inventoryItemId, locationId, delta }],
    },
  });

  shopifyClient.checkUserErrors(data.inventoryAdjustQuantities.userErrors, 'adjustInventoryQuantity');
}

// ============ Orders ============

export async function getOrders(first: number = 50, after?: string): Promise<{
  orders: ShopifyOrder[];
  pageInfo: { hasNextPage: boolean; endCursor?: string };
}> {
  const query = `
    query GetOrders($first: Int!, $after: String) {
      orders(first: $first, after: $after, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            name
            email
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            displayFinancialStatus
            displayFulfillmentStatus
            createdAt
            lineItems(first: 50) {
              edges {
                node {
                  id
                  title
                  quantity
                  sku
                }
              }
            }
            customer {
              id
              email
              firstName
              lastName
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  const data = await shopifyClient.graphql<{
    orders: {
      edges: Array<{ node: ShopifyOrder }>;
      pageInfo: { hasNextPage: boolean; endCursor?: string };
    };
  }>(query, { first, after });

  return {
    orders: data.orders.edges.map(e => e.node),
    pageInfo: data.orders.pageInfo,
  };
}

export async function getOrderByName(name: string): Promise<ShopifyOrder | null> {
  const query = `
    query GetOrderByName($query: String!) {
      orders(first: 1, query: $query) {
        edges {
          node {
            id
            name
            email
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            displayFinancialStatus
            displayFulfillmentStatus
            createdAt
            lineItems(first: 50) {
              edges {
                node {
                  id
                  title
                  quantity
                  sku
                }
              }
            }
            customer {
              id
              email
              firstName
              lastName
            }
          }
        }
      }
    }
  `;

  const data = await shopifyClient.graphql<{
    orders: { edges: Array<{ node: ShopifyOrder }> };
  }>(query, { query: `name:${name}` });

  return data.orders.edges[0]?.node ?? null;
}

// ============ Fulfillments ============

export async function createFulfillment(
  orderId: string,
  input: {
    trackingNumber?: string;
    trackingCompany?: string;
    trackingUrl?: string;
    notifyCustomer?: boolean;
  }
): Promise<ShopifyFulfillment> {
  // First, get the fulfillment order ID
  const fulfillmentOrderQuery = `
    query GetFulfillmentOrders($orderId: ID!) {
      order(id: $orderId) {
        fulfillmentOrders(first: 10) {
          edges {
            node {
              id
              status
            }
          }
        }
      }
    }
  `;

  const foData = await shopifyClient.graphql<{
    order: {
      fulfillmentOrders: {
        edges: Array<{ node: { id: string; status: string } }>;
      };
    };
  }>(fulfillmentOrderQuery, { orderId });

  const openFulfillmentOrder = foData.order.fulfillmentOrders.edges.find(
    e => e.node.status === 'OPEN' || e.node.status === 'IN_PROGRESS'
  );

  if (!openFulfillmentOrder) {
    throw new Error('No open fulfillment order found');
  }

  const mutation = `
    mutation CreateFulfillment($fulfillment: FulfillmentV2Input!) {
      fulfillmentCreateV2(fulfillment: $fulfillment) {
        fulfillment {
          id
          status
          trackingInfo {
            number
            company
            url
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const trackingInfo = input.trackingNumber
    ? [{
        number: input.trackingNumber,
        company: input.trackingCompany,
        url: input.trackingUrl,
      }]
    : [];

  const data = await shopifyClient.graphql<{
    fulfillmentCreateV2: {
      fulfillment: ShopifyFulfillment | null;
      userErrors: UserError[];
    };
  }>(mutation, {
    fulfillment: {
      lineItemsByFulfillmentOrder: [{
        fulfillmentOrderId: openFulfillmentOrder.node.id,
      }],
      trackingInfo: trackingInfo.length > 0 ? trackingInfo[0] : undefined,
      notifyCustomer: input.notifyCustomer ?? true,
    },
  });

  shopifyClient.checkUserErrors(data.fulfillmentCreateV2.userErrors, 'createFulfillment');
  return data.fulfillmentCreateV2.fulfillment!;
}

// ============ Customers ============

export async function getCustomers(first: number = 50, after?: string): Promise<{
  customers: ShopifyCustomer[];
  pageInfo: { hasNextPage: boolean; endCursor?: string };
}> {
  const query = `
    query GetCustomers($first: Int!, $after: String) {
      customers(first: $first, after: $after) {
        edges {
          node {
            id
            email
            firstName
            lastName
            phone
            addresses(first: 10) {
              edges {
                node {
                  id
                  address1
                  city
                  province
                  country
                  zip
                }
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  const data = await shopifyClient.graphql<{
    customers: {
      edges: Array<{ node: ShopifyCustomer }>;
      pageInfo: { hasNextPage: boolean; endCursor?: string };
    };
  }>(query, { first, after });

  return {
    customers: data.customers.edges.map(e => e.node),
    pageInfo: data.customers.pageInfo,
  };
}

// ============ Catalogs ============

export interface ShopifyCatalog {
  id: string;
  title: string;
  status: string;
}

export async function getCatalogs(): Promise<ShopifyCatalog[]> {
  const query = `
    query GetCatalogs {
      catalogs(first: 50) {
        edges {
          node {
            id
            title
            status
          }
        }
      }
    }
  `;

  const data = await shopifyClient.graphql<{
    catalogs: { edges: Array<{ node: ShopifyCatalog }> };
  }>(query);

  return data.catalogs.edges.map(e => e.node);
}

export async function createCatalog(title: string): Promise<ShopifyCatalog> {
  const mutation = `
    mutation CreateCatalog($input: CatalogCreateInput!) {
      catalogCreate(input: $input) {
        catalog {
          id
          title
          status
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const data = await shopifyClient.graphql<{
    catalogCreate: { catalog: ShopifyCatalog | null; userErrors: UserError[] };
  }>(mutation, {
    input: { title, status: 'ACTIVE' },
  });

  shopifyClient.checkUserErrors(data.catalogCreate.userErrors, 'createCatalog');
  return data.catalogCreate.catalog!;
}

// ============ Metaobjects ============

export interface ShopifyMetaobject {
  id: string;
  handle: string;
  type: string;
  fields: Array<{ key: string; value: string }>;
}

export async function getMetaobjects(type: string, first: number = 50): Promise<{
  metaobjects: ShopifyMetaobject[];
  pageInfo: { hasNextPage: boolean; endCursor?: string };
}> {
  const query = `
    query GetMetaobjects($type: String!, $first: Int!) {
      metaobjects(type: $type, first: $first) {
        edges {
          node {
            id
            handle
            type
            fields {
              key
              value
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  const data = await shopifyClient.graphql<{
    metaobjects: {
      edges: Array<{ node: ShopifyMetaobject }>;
      pageInfo: { hasNextPage: boolean; endCursor?: string };
    };
  }>(query, { type, first });

  return {
    metaobjects: data.metaobjects.edges.map(e => e.node),
    pageInfo: data.metaobjects.pageInfo,
  };
}

export async function upsertMetaobject(
  type: string,
  handle: string,
  fields: Array<{ key: string; value: string }>
): Promise<ShopifyMetaobject> {
  const mutation = `
    mutation UpsertMetaobject($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
      metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
        metaobject {
          id
          handle
          type
          fields {
            key
            value
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const data = await shopifyClient.graphql<{
    metaobjectUpsert: { metaobject: ShopifyMetaobject | null; userErrors: UserError[] };
  }>(mutation, {
    handle: { type, handle },
    metaobject: { fields },
  });

  shopifyClient.checkUserErrors(data.metaobjectUpsert.userErrors, 'upsertMetaobject');
  return data.metaobjectUpsert.metaobject!;
}

// ============ Discounts ============

export interface ShopifyDiscount {
  id: string;
  title: string;
  status: string;
  startsAt: string;
  endsAt: string | null;
}

export async function getDiscounts(): Promise<ShopifyDiscount[]> {
  const query = `
    query GetDiscounts {
      discountNodes(first: 50) {
        edges {
          node {
            id
            discount {
              ... on DiscountCodeBasic {
                title
                status
                startsAt
                endsAt
              }
              ... on DiscountCodeBxgy {
                title
                status
                startsAt
                endsAt
              }
              ... on DiscountCodeFreeShipping {
                title
                status
                startsAt
                endsAt
              }
            }
          }
        }
      }
    }
  `;

  const data = await shopifyClient.graphql<{
    discountNodes: {
      edges: Array<{
        node: {
          id: string;
          discount: { title: string; status: string; startsAt: string; endsAt: string | null };
        };
      }>;
    };
  }>(query);

  return data.discountNodes.edges.map(e => ({
    id: e.node.id,
    ...e.node.discount,
  }));
}

export async function createDiscountCode(input: {
  title: string;
  code: string;
  startsAt: string;
  endsAt?: string;
  value: { percentage?: number; fixedAmount?: { amount: string; currencyCode: string } };
}): Promise<ShopifyDiscount> {
  const mutation = `
    mutation CreateDiscountCode($basicCodeDiscount: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
        codeDiscountNode {
          id
          codeDiscount {
            ... on DiscountCodeBasic {
              title
              status
              startsAt
              endsAt
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const customerGets = input.value.percentage
    ? {
        value: { percentage: input.value.percentage / 100 },
        items: { all: true },
      }
    : {
        value: { discountAmount: input.value.fixedAmount },
        items: { all: true },
      };

  const data = await shopifyClient.graphql<{
    discountCodeBasicCreate: {
      codeDiscountNode: {
        id: string;
        codeDiscount: { title: string; status: string; startsAt: string; endsAt: string | null };
      } | null;
      userErrors: UserError[];
    };
  }>(mutation, {
    basicCodeDiscount: {
      title: input.title,
      code: input.code,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      customerGets,
      customerSelection: { all: true },
    },
  });

  shopifyClient.checkUserErrors(data.discountCodeBasicCreate.userErrors, 'createDiscountCode');
  const node = data.discountCodeBasicCreate.codeDiscountNode!;
  return {
    id: node.id,
    ...node.codeDiscount,
  };
}

// ============ Gift Cards ============

export interface ShopifyGiftCard {
  id: string;
  code: string;
  initialValue: { amount: string; currencyCode: string };
  balance: { amount: string; currencyCode: string };
  enabled: boolean;
}

export async function getGiftCards(): Promise<ShopifyGiftCard[]> {
  const query = `
    query GetGiftCards {
      giftCards(first: 50) {
        edges {
          node {
            id
            maskedCode
            initialValue {
              amount
              currencyCode
            }
            balance {
              amount
              currencyCode
            }
            enabled
          }
        }
      }
    }
  `;

  const data = await shopifyClient.graphql<{
    giftCards: {
      edges: Array<{
        node: {
          id: string;
          maskedCode: string;
          initialValue: { amount: string; currencyCode: string };
          balance: { amount: string; currencyCode: string };
          enabled: boolean;
        };
      }>;
    };
  }>(query);

  return data.giftCards.edges.map(e => ({
    id: e.node.id,
    code: e.node.maskedCode,
    initialValue: e.node.initialValue,
    balance: e.node.balance,
    enabled: e.node.enabled,
  }));
}

export async function createGiftCard(input: {
  initialValue: string;
  code?: string;
  note?: string;
}): Promise<ShopifyGiftCard & { plaintextCode?: string }> {
  // Note: giftCardCode returns the plaintext code ONLY at creation time
  // After creation, only maskedCode is available
  const mutation = `
    mutation CreateGiftCard($input: GiftCardCreateInput!) {
      giftCardCreate(input: $input) {
        giftCard {
          id
          maskedCode
          initialValue {
            amount
            currencyCode
          }
          balance {
            amount
            currencyCode
          }
          enabled
        }
        giftCardCode
        userErrors {
          field
          message
        }
      }
    }
  `;

  const data = await shopifyClient.graphql<{
    giftCardCreate: {
      giftCard: {
        id: string;
        maskedCode: string;
        initialValue: { amount: string; currencyCode: string };
        balance: { amount: string; currencyCode: string };
        enabled: boolean;
      } | null;
      giftCardCode: string | null;  // Full plaintext code, only available at creation
      userErrors: UserError[];
    };
  }>(mutation, {
    input: {
      initialValue: input.initialValue,
      code: input.code,
      note: input.note,
    },
  });

  shopifyClient.checkUserErrors(data.giftCardCreate.userErrors, 'createGiftCard');
  const gc = data.giftCardCreate.giftCard!;
  return {
    id: gc.id,
    code: data.giftCardCreate.giftCardCode || gc.maskedCode, // Use plaintext if available
    plaintextCode: data.giftCardCreate.giftCardCode || undefined, // Explicit plaintext for logging
    initialValue: gc.initialValue,
    balance: gc.balance,
    enabled: gc.enabled,
  };
}
