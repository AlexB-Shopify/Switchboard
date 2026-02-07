/**
 * Base Handler
 * Abstract base class for all data object handlers
 */

import { 
  configManager, 
  type DataObjectName, 
  type DataObjectConfig,
  type ExistingDataBehavior 
} from '../config';
import { logger, type SyncSummary, type ChildLogger } from '../core/logger';
import { type Job } from '../core/queue';
import {
  markSyncStarted,
  markSyncCompleted,
  markSyncFailed,
  createJobLog,
  markJobStarted,
  markJobCompleted,
  markJobFailed,
  getSyncState,
} from '../db/client';
import {
  createMapping,
  getManagedItems,
  lookupByExternalId,
  lookupByShopifyId,
} from '../utils/idMapping';
import { detectDeltas, type SyncItem, type DeltaResult } from '../utils/delta';

/**
 * Result of processing a single item
 */
export interface ItemResult {
  success: boolean;
  action: 'created' | 'updated' | 'deleted' | 'unchanged' | 'skipped';
  externalId: string;
  shopifyId?: string;
  error?: string;
}

/**
 * Sync statistics
 */
export interface SyncStats {
  processed: number;
  succeeded: number;
  failed: number;
  unchanged: number;
  created: number;
  updated: number;
  deleted: number;
}

/**
 * Abstract base handler class
 */
export abstract class BaseHandler {
  protected readonly name: DataObjectName;
  protected readonly log: ChildLogger;
  private _config: DataObjectConfig | null = null;

  constructor(name: DataObjectName) {
    this.name = name;
    this.log = logger.child({ dataObject: name });
    // Note: config is loaded lazily to avoid initialization order issues
    // The config will be loaded when first accessed via the getter
  }

  /**
   * Get the config for this data object (lazy-loaded)
   */
  protected get config(): DataObjectConfig {
    if (!this._config) {
      this._config = configManager.getDataObject(this.name);
    }
    return this._config;
  }

  /**
   * Refresh config (useful if config changes at runtime)
   */
  protected refreshConfig(): void {
    this._config = configManager.getDataObject(this.name);
  }

  /**
   * Handle a sync or webhook job
   */
  async handle(job: Job): Promise<void> {
    this.refreshConfig();

    if (job.type === 'webhook') {
      await this.handleWebhook(job);
    } else {
      await this.handleSync(job);
    }
  }

  /**
   * Handle a sync job
   */
  private async handleSync(job: Job): Promise<void> {
    const startTime = Date.now();
    const jobLogId = await createJobLog(this.name, 'sync');

    try {
      await markSyncStarted(this.name);
      await markJobStarted(jobLogId);
      
      logger.syncStart(this.name);

      const stats = await this.sync();

      await markSyncCompleted(this.name);
      await markJobCompleted(jobLogId, {
        processed: stats.processed,
        succeeded: stats.succeeded,
        failed: stats.failed,
      });

      const summary: SyncSummary = {
        dataObject: this.name,
        processed: stats.processed,
        succeeded: stats.succeeded,
        failed: stats.failed,
        unchanged: stats.unchanged,
        duration: Date.now() - startTime,
      };

      logger.syncComplete(summary);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      await markSyncFailed(this.name);
      await markJobFailed(jobLogId, errorMessage);

      this.log.error(`Sync failed: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Handle a webhook job
   */
  private async handleWebhook(job: Job): Promise<void> {
    const jobLogId = await createJobLog(this.name, 'webhook');

    try {
      await markJobStarted(jobLogId);

      const payload = job.payload as {
        eventId: string;
        topic: string;
        shopifyId: string;
        data: Record<string, unknown>;
      };

      await this.processWebhook(payload.topic, payload.shopifyId, payload.data);

      await markJobCompleted(jobLogId, {
        processed: 1,
        succeeded: 1,
        failed: 0,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      await markJobFailed(jobLogId, errorMessage);

      this.log.error(`Webhook processing failed: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Perform the sync operation
   * Must be implemented by subclasses
   */
  protected abstract sync(): Promise<SyncStats>;

  /**
   * Process a webhook event
   * Override in subclasses that handle webhooks
   */
  protected async processWebhook(
    _topic: string,
    _shopifyId: string,
    _data: Record<string, unknown>
  ): Promise<void> {
    this.log.warn('Webhook processing not implemented for this handler');
  }

  /**
   * Get the external ID field name for this data object
   */
  protected getExternalIdField(): string {
    return this.config.externalIdField || 'id';
  }

  /**
   * Get the existing data behavior setting
   */
  protected getExistingDataBehavior(): ExistingDataBehavior {
    return this.config.existingDataBehavior || 'ignore';
  }

  /**
   * Check if this is a managed item (created by Switchboard)
   */
  protected async isManaged(externalId: string): Promise<boolean> {
    const lookup = await lookupByExternalId(this.name, externalId);
    return lookup.found;
  }

  /**
   * Look up Shopify ID for an external ID
   */
  protected async getShopifyId(externalId: string): Promise<string | null> {
    const lookup = await lookupByExternalId(this.name, externalId);
    return lookup.shopifyId;
  }

  /**
   * Look up external ID for a Shopify ID
   */
  protected async getExternalId(shopifyId: string): Promise<string | null> {
    const lookup = await lookupByShopifyId(this.name, shopifyId);
    return lookup.externalId;
  }

  /**
   * Create an ID mapping
   */
  protected async createIdMapping(externalId: string, shopifyId: string): Promise<void> {
    await createMapping(this.name, externalId, shopifyId);
  }

  /**
   * Get all managed items
   */
  protected async getManagedItems(): Promise<Map<string, string>> {
    return getManagedItems(this.name);
  }

  /**
   * Detect deltas between source and destination
   */
  protected async detectDeltas<T extends Record<string, unknown>>(
    sourceItems: T[],
    getExternalId: (item: T) => string
  ): Promise<DeltaResult<T>> {
    return detectDeltas(this.name, sourceItems, getExternalId, this.config.mode);
  }

  /**
   * Process items in batches
   */
  protected async processBatch<T>(
    items: T[],
    processor: (item: T) => Promise<ItemResult>,
    batchSize: number = 10
  ): Promise<SyncStats> {
    const stats: SyncStats = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      unchanged: 0,
      created: 0,
      updated: 0,
      deleted: 0,
    };

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (item) => {
        stats.processed++;
        
        try {
          const result = await processor(item);
          
          if (result.success) {
            stats.succeeded++;
            
            switch (result.action) {
              case 'created':
                stats.created++;
                logger.syncItemSuccess(this.name, result.externalId, 'created');
                break;
              case 'updated':
                stats.updated++;
                logger.syncItemSuccess(this.name, result.externalId, 'updated');
                break;
              case 'deleted':
                stats.deleted++;
                logger.syncItemSuccess(this.name, result.externalId, 'deleted');
                break;
              case 'unchanged':
                stats.unchanged++;
                break;
            }
          } else {
            stats.failed++;
            logger.syncItemFailed(this.name, result.externalId, result.error || 'Unknown error');
          }
        } catch (error) {
          stats.failed++;
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.syncItemFailed(this.name, 'unknown', errorMessage);
        }
      }));
    }

    return stats;
  }

  /**
   * Helper to create a success result
   */
  protected successResult(
    action: 'created' | 'updated' | 'deleted' | 'unchanged',
    externalId: string,
    shopifyId?: string
  ): ItemResult {
    return { success: true, action, externalId, shopifyId };
  }

  /**
   * Helper to create a failure result
   */
  protected failureResult(externalId: string, error: string): ItemResult {
    return { success: false, action: 'skipped', externalId, error };
  }

  /**
   * Get the last sync timestamp
   */
  protected async getLastSyncTime(): Promise<Date | null> {
    const state = await getSyncState(this.name);
    return state.lastSuccessAt;
  }

  /**
   * Should this item be processed based on existing data behavior?
   */
  protected async shouldProcessExistingItem(
    shopifyId: string,
    externalId?: string
  ): Promise<boolean> {
    const behavior = this.getExistingDataBehavior();

    switch (behavior) {
      case 'ignore':
        // Only process if we have a mapping (it's managed by us)
        if (externalId) {
          return await this.isManaged(externalId);
        }
        const existingExtId = await this.getExternalId(shopifyId);
        return existingExtId !== null;

      case 'adopt':
      case 'adopt_and_archive':
        // Always process - we'll create mappings as needed
        return true;

      default:
        return false;
    }
  }
}

/**
 * Source item type with row index
 */
export interface SourceItem {
  _rowIndex: number;
  shopify_id?: string;
  [key: string]: string | number | undefined;
}

/**
 * Base handler for to_shopify direction (ERP -> Shopify)
 */
export abstract class ToShopifyHandler extends BaseHandler {
  /**
   * Read items from the source (Google Sheets)
   */
  protected abstract readSourceItems(): Promise<SourceItem[]>;

  /**
   * Create an item in Shopify
   */
  protected abstract createInShopify(item: SourceItem): Promise<string>;

  /**
   * Update an item in Shopify
   */
  protected abstract updateInShopify(shopifyId: string, item: SourceItem): Promise<void>;

  /**
   * Update the Shopify ID in the source sheet
   */
  protected abstract updateSourceShopifyId(rowIndex: number, shopifyId: string): Promise<void>;

  /**
   * Perform the sync operation
   */
  protected async sync(): Promise<SyncStats> {
    // Read items from source
    const sourceItems = await this.readSourceItems();
    this.log.debug(`Read ${sourceItems.length} items from source`);

    // Detect what needs to be synced
    const externalIdField = this.getExternalIdField();
    const deltas = await this.detectDeltas(
      sourceItems as unknown as Record<string, unknown>[],
      (item) => String(item[externalIdField] || '')
    );

    this.log.debug(
      `Delta: ${deltas.toCreate.length} to create, ${deltas.toUpdate.length} to update, ${deltas.toDelete.length} to delete`
    );

    // Process items
    const allItems = [
      ...deltas.toCreate.map(item => ({ ...item, _action: 'create' as const })),
      ...deltas.toUpdate.map(item => ({ ...item, _action: 'update' as const })),
    ];

    return this.processBatch(allItems, async (item) => {
      const externalId = item.externalId;
      const data = item.data as SourceItem;
      const rowIndex = data._rowIndex;

      try {
        if (item._action === 'create') {
          const shopifyId = await this.createInShopify(data);
          await this.createIdMapping(externalId, shopifyId);
          await this.updateSourceShopifyId(rowIndex, shopifyId);
          return this.successResult('created', externalId, shopifyId);
        } else {
          const shopifyId = item.shopifyId!;
          await this.updateInShopify(shopifyId, data);
          return this.successResult('updated', externalId, shopifyId);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return this.failureResult(externalId, errorMessage);
      }
    });
  }
}

/**
 * Base handler for from_shopify direction (Shopify -> ERP)
 */
export abstract class FromShopifyHandler extends BaseHandler {
  /**
   * Process a webhook and write to sheet
   */
  protected abstract processWebhookData(
    topic: string,
    shopifyId: string,
    data: Record<string, unknown>
  ): Promise<void>;

  /**
   * Perform the sync operation (typically a no-op for webhook-based handlers)
   */
  protected async sync(): Promise<SyncStats> {
    // For webhook-based handlers, sync is typically not needed
    // But can be used for initial data load or reconciliation
    this.log.debug('Sync called on webhook-based handler - no action taken');
    return {
      processed: 0,
      succeeded: 0,
      failed: 0,
      unchanged: 0,
      created: 0,
      updated: 0,
      deleted: 0,
    };
  }

  /**
   * Process a webhook event
   */
  protected async processWebhook(
    topic: string,
    shopifyId: string,
    data: Record<string, unknown>
  ): Promise<void> {
    await this.processWebhookData(topic, shopifyId, data);
  }
}
