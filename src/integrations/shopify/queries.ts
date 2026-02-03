/**
 * Shopify GraphQL Queries and Mutations
 * Organized by data object type
 */

import { shopifyClient, type UserError, type Connection } from './client';

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
  descriptionHtml?: string;
  vendor?: string;
  productType?: string;
  tags?: string[];
  status?: 'ACTIVE' | 'ARCHIVED' | 'DRAFT';
}): Promise<ShopifyProduct> {
  const mutation = `
    mutation CreateProduct($input: ProductInput!) {
      productCreate(input: $input) {
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
    productCreate: { product: ShopifyProduct | null; userErrors: UserError[] };
  }>(mutation, { input });

  shopifyClient.checkUserErrors(data.productCreate.userErrors, 'createProduct');
  return data.productCreate.product!;
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
    sku: string;
    price: string;
    title?: string;
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

  const data = await shopifyClient.graphql<{
    productVariantsBulkCreate: {
      productVariants: ShopifyVariant[] | null;
      userErrors: UserError[];
    };
  }>(mutation, {
    productId,
    variants: [input],
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

export async function setInventoryQuantity(
  inventoryItemId: string,
  locationId: string,
  quantity: number
): Promise<void> {
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
}): Promise<ShopifyGiftCard> {
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
    code: gc.maskedCode,
    initialValue: gc.initialValue,
    balance: gc.balance,
    enabled: gc.enabled,
  };
}
