/**
 * ID Mapping Utilities
 * Helper functions for managing external ID <-> Shopify ID mappings
 */

import type { DataObjectName } from '../config';
import {
  getShopifyId,
  getExternalId,
  upsertIdMapping,
  deleteIdMapping,
  getAllIdMappings,
  hasMapping,
} from '../db/client';

/**
 * Metafield namespace and key for storing external IDs on Shopify resources
 */
export const ERP_METAFIELD_NAMESPACE = 'custom';
export const ERP_METAFIELD_KEY = 'erp_external_id';

/**
 * Result of a lookup operation
 */
export interface LookupResult {
  found: boolean;
  shopifyId: string | null;
  externalId: string | null;
}

/**
 * Look up a Shopify ID by external ID
 */
export async function lookupByExternalId(
  dataObject: DataObjectName,
  externalId: string
): Promise<LookupResult> {
  const shopifyId = await getShopifyId(dataObject, externalId);
  return {
    found: shopifyId !== null,
    shopifyId,
    externalId,
  };
}

/**
 * Look up an external ID by Shopify ID
 */
export async function lookupByShopifyId(
  dataObject: DataObjectName,
  shopifyId: string
): Promise<LookupResult> {
  const externalId = await getExternalId(dataObject, shopifyId);
  return {
    found: externalId !== null,
    shopifyId,
    externalId,
  };
}

/**
 * Create or update a bidirectional ID mapping
 */
export async function createMapping(
  dataObject: DataObjectName,
  externalId: string,
  shopifyId: string
): Promise<void> {
  await upsertIdMapping(dataObject, externalId, shopifyId);
}

/**
 * Remove an ID mapping
 */
export async function removeMapping(
  dataObject: DataObjectName,
  externalId: string
): Promise<void> {
  await deleteIdMapping(dataObject, externalId);
}

/**
 * Check if an item is managed by Switchboard (has an ID mapping)
 */
export async function isManaged(
  dataObject: DataObjectName,
  externalId: string
): Promise<boolean> {
  return hasMapping(dataObject, externalId);
}

/**
 * Get all managed items for a data object
 */
export async function getManagedItems(
  dataObject: DataObjectName
): Promise<Map<string, string>> {
  const mappings = await getAllIdMappings(dataObject);
  const map = new Map<string, string>();
  
  for (const { externalId, shopifyId } of mappings) {
    map.set(externalId, shopifyId);
  }
  
  return map;
}

/**
 * Batch lookup multiple external IDs
 */
export async function batchLookupByExternalIds(
  dataObject: DataObjectName,
  externalIds: string[]
): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();
  
  // For now, do sequential lookups
  // TODO: Optimize with a single query if needed
  for (const externalId of externalIds) {
    const shopifyId = await getShopifyId(dataObject, externalId);
    results.set(externalId, shopifyId);
  }
  
  return results;
}

/**
 * Extract external ID from a Shopify resource's metafields
 */
export function extractExternalIdFromMetafields(
  metafields: Array<{ namespace: string; key: string; value: string }>
): string | null {
  const metafield = metafields.find(
    m => m.namespace === ERP_METAFIELD_NAMESPACE && m.key === ERP_METAFIELD_KEY
  );
  return metafield?.value ?? null;
}

/**
 * Create metafield input for setting external ID on a Shopify resource
 */
export function createExternalIdMetafieldInput(
  ownerId: string,
  externalId: string
): {
  ownerId: string;
  namespace: string;
  key: string;
  value: string;
  type: string;
} {
  return {
    ownerId,
    namespace: ERP_METAFIELD_NAMESPACE,
    key: ERP_METAFIELD_KEY,
    value: externalId,
    type: 'single_line_text_field',
  };
}
