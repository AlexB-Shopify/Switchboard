/**
 * Delta Detection Utilities
 * Helper functions for detecting changes between source and destination
 */

import type { DataObjectName } from '../config';
import { getManagedItems } from './idMapping';

/**
 * Represents an item that needs to be synced
 */
export interface SyncItem<T = Record<string, unknown>> {
  externalId: string;
  data: T;
  shopifyId?: string;
}

/**
 * Result of delta detection
 */
export interface DeltaResult<T = Record<string, unknown>> {
  toCreate: SyncItem<T>[];  // Items that exist in source but not in destination
  toUpdate: SyncItem<T>[];  // Items that exist in both and may need updating
  toDelete: string[];        // External IDs that exist in destination but not in source
  unchanged: number;         // Count of items that are unchanged
}

/**
 * Detect deltas between source items and managed items in destination
 * 
 * @param dataObject - The data object type
 * @param sourceItems - Items from the source (ERP/Sheet)
 * @param getExternalId - Function to extract external ID from source item
 * @param mode - 'sync' includes deletes, 'overwrite' only creates/updates
 */
export async function detectDeltas<T extends Record<string, unknown>>(
  dataObject: DataObjectName,
  sourceItems: T[],
  getExternalId: (item: T) => string,
  mode: 'sync' | 'overwrite' = 'sync'
): Promise<DeltaResult<T>> {
  // Get all currently managed items
  const managedItems = await getManagedItems(dataObject);
  
  const toCreate: SyncItem<T>[] = [];
  const toUpdate: SyncItem<T>[] = [];
  const sourceExternalIds = new Set<string>();

  // Process each source item
  for (const item of sourceItems) {
    const externalId = getExternalId(item);
    sourceExternalIds.add(externalId);

    const shopifyId = managedItems.get(externalId);

    if (shopifyId) {
      // Item exists in destination - needs update check
      toUpdate.push({
        externalId,
        data: item,
        shopifyId,
      });
    } else {
      // Item doesn't exist in destination - needs creation
      toCreate.push({
        externalId,
        data: item,
      });
    }
  }

  // Find items to delete (in destination but not in source)
  const toDelete: string[] = [];
  if (mode === 'sync') {
    for (const [externalId] of managedItems) {
      if (!sourceExternalIds.has(externalId)) {
        toDelete.push(externalId);
      }
    }
  }

  return {
    toCreate,
    toUpdate,
    toDelete,
    unchanged: 0, // Will be calculated after actual comparison
  };
}

/**
 * Compare two objects for equality (shallow)
 */
export function shallowEqual(
  obj1: Record<string, unknown>,
  obj2: Record<string, unknown>,
  keys?: string[]
): boolean {
  const keysToCompare = keys || Object.keys(obj1);
  
  for (const key of keysToCompare) {
    if (obj1[key] !== obj2[key]) {
      return false;
    }
  }
  
  return true;
}

/**
 * Get the differences between two objects
 */
export function getDifferences(
  source: Record<string, unknown>,
  destination: Record<string, unknown>,
  keys?: string[]
): Record<string, { source: unknown; destination: unknown }> {
  const differences: Record<string, { source: unknown; destination: unknown }> = {};
  const keysToCompare = keys || Object.keys(source);
  
  for (const key of keysToCompare) {
    if (source[key] !== destination[key]) {
      differences[key] = {
        source: source[key],
        destination: destination[key],
      };
    }
  }
  
  return differences;
}

/**
 * Filter items that have actual changes
 * Compares source data with destination data
 */
export function filterChangedItems<T extends Record<string, unknown>>(
  items: SyncItem<T>[],
  getDestinationData: (shopifyId: string) => Record<string, unknown> | null,
  compareKeys?: string[]
): { changed: SyncItem<T>[]; unchanged: SyncItem<T>[] } {
  const changed: SyncItem<T>[] = [];
  const unchanged: SyncItem<T>[] = [];

  for (const item of items) {
    if (!item.shopifyId) {
      // No shopifyId means it's new, so it's "changed"
      changed.push(item);
      continue;
    }

    const destData = getDestinationData(item.shopifyId);
    if (!destData) {
      // Destination data not available, assume changed
      changed.push(item);
      continue;
    }

    if (shallowEqual(item.data, destData, compareKeys)) {
      unchanged.push(item);
    } else {
      changed.push(item);
    }
  }

  return { changed, unchanged };
}

/**
 * Batch items for processing
 */
export function batchItems<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  
  return batches;
}

/**
 * Create a hash of an object for quick comparison
 */
export function hashObject(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

/**
 * Deduplicate items by external ID (keeps last occurrence)
 */
export function deduplicateByExternalId<T>(
  items: T[],
  getExternalId: (item: T) => string
): T[] {
  const map = new Map<string, T>();
  
  for (const item of items) {
    const externalId = getExternalId(item);
    map.set(externalId, item);
  }
  
  return Array.from(map.values());
}
