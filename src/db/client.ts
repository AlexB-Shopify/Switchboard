/**
 * Database Client
 * Prisma client wrapper with connection management
 */

import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import type { DataObjectName } from '../config';

// Singleton Prisma client instance
let prisma: PrismaClient | null = null;

/**
 * Get the Prisma client instance
 */
export function getDb(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
  }
  return prisma;
}

/**
 * Initialize the database schema using Prisma
 */
function initializeDatabase(): void {
  console.log('Database not found or not initialized. Running prisma db push...');
  try {
    // Run prisma db push to create the database and schema
    execSync('npx prisma db push --skip-generate', {
      stdio: 'inherit',
      cwd: process.cwd(),
    });
    console.log('Database initialized successfully.');
  } catch (error) {
    throw new Error(`Failed to initialize database: ${error}`);
  }
}

/**
 * Initialize the database connection
 */
export async function initDb(): Promise<void> {
  const db = getDb();
  
  try {
    // Try to connect and run a simple query to verify the database is set up
    await db.$connect();
    // Test query to ensure tables exist
    await db.$queryRaw`SELECT 1`;
  } catch (error) {
    // If connection fails, try to initialize the database
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    if (errorMessage.includes('Unable to open') || 
        errorMessage.includes('no such table') ||
        errorMessage.includes('does not exist')) {
      // Database doesn't exist or isn't initialized - create it
      initializeDatabase();
      
      // Recreate the Prisma client after db push
      prisma = null;
      const newDb = getDb();
      await newDb.$connect();
    } else {
      // Some other error - rethrow
      throw error;
    }
  }
}

/**
 * Close the database connection
 */
export async function closeDb(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
}

/**
 * Reset the database (for demo mode)
 * Deletes all data from all tables
 */
export async function resetDb(): Promise<void> {
  const db = getDb();
  
  // Delete in order to respect foreign key constraints (if any)
  await db.webhookEvent.deleteMany();
  await db.jobLog.deleteMany();
  await db.idMapping.deleteMany();
  await db.syncState.deleteMany();
}

// ============ Sync State Helpers ============

export interface SyncStateData {
  lastSyncAt: Date | null;
  lastSuccessAt: Date | null;
  cursor: string | null;
  status: string;
}

/**
 * Get or create sync state for a data object
 */
export async function getSyncState(dataObject: DataObjectName): Promise<SyncStateData> {
  const db = getDb();
  
  // Use upsert to avoid race conditions when multiple jobs start simultaneously
  const state = await db.syncState.upsert({
    where: { dataObject },
    create: { dataObject },
    update: {}, // No updates, just return existing
  });

  return {
    lastSyncAt: state.lastSyncAt,
    lastSuccessAt: state.lastSuccessAt,
    cursor: state.cursor,
    status: state.status,
  };
}

/**
 * Update sync state for a data object
 */
export async function updateSyncState(
  dataObject: DataObjectName,
  updates: Partial<SyncStateData>
): Promise<void> {
  const db = getDb();
  
  await db.syncState.upsert({
    where: { dataObject },
    create: { 
      dataObject,
      ...updates,
    },
    update: updates,
  });
}

/**
 * Mark a sync as started
 */
export async function markSyncStarted(dataObject: DataObjectName): Promise<void> {
  await updateSyncState(dataObject, {
    status: 'running',
    lastSyncAt: new Date(),
  });
}

/**
 * Mark a sync as completed successfully
 */
export async function markSyncCompleted(
  dataObject: DataObjectName,
  cursor?: string
): Promise<void> {
  await updateSyncState(dataObject, {
    status: 'idle',
    lastSuccessAt: new Date(),
    cursor: cursor ?? null,
  });
}

/**
 * Mark a sync as failed
 */
export async function markSyncFailed(dataObject: DataObjectName): Promise<void> {
  await updateSyncState(dataObject, {
    status: 'failed',
  });
}

/**
 * Check if a sync is currently running
 */
export async function isSyncRunning(dataObject: DataObjectName): Promise<boolean> {
  const state = await getSyncState(dataObject);
  return state.status === 'running';
}

// ============ ID Mapping Helpers ============

export interface IdMappingData {
  externalId: string;
  shopifyId: string;
}

/**
 * Get Shopify ID for an external ID
 */
export async function getShopifyId(
  dataObject: DataObjectName,
  externalId: string
): Promise<string | null> {
  const db = getDb();
  
  const mapping = await db.idMapping.findUnique({
    where: {
      dataObject_externalId: { dataObject, externalId },
    },
  });

  return mapping?.shopifyId ?? null;
}

/**
 * Get external ID for a Shopify ID
 */
export async function getExternalId(
  dataObject: DataObjectName,
  shopifyId: string
): Promise<string | null> {
  const db = getDb();
  
  const mapping = await db.idMapping.findUnique({
    where: {
      dataObject_shopifyId: { dataObject, shopifyId },
    },
  });

  return mapping?.externalId ?? null;
}

/**
 * Create or update an ID mapping
 */
export async function upsertIdMapping(
  dataObject: DataObjectName,
  externalId: string,
  shopifyId: string
): Promise<void> {
  const db = getDb();
  
  await db.idMapping.upsert({
    where: {
      dataObject_externalId: { dataObject, externalId },
    },
    create: {
      dataObject,
      externalId,
      shopifyId,
    },
    update: {
      shopifyId,
    },
  });
}

/**
 * Delete an ID mapping
 */
export async function deleteIdMapping(
  dataObject: DataObjectName,
  externalId: string
): Promise<void> {
  const db = getDb();
  
  await db.idMapping.deleteMany({
    where: { dataObject, externalId },
  });
}

/**
 * Get all ID mappings for a data object
 */
export async function getAllIdMappings(
  dataObject: DataObjectName
): Promise<IdMappingData[]> {
  const db = getDb();
  
  const mappings = await db.idMapping.findMany({
    where: { dataObject },
    select: { externalId: true, shopifyId: true },
  });

  return mappings;
}

/**
 * Check if an external ID has a mapping
 */
export async function hasMapping(
  dataObject: DataObjectName,
  externalId: string
): Promise<boolean> {
  const shopifyId = await getShopifyId(dataObject, externalId);
  return shopifyId !== null;
}

// ============ Job Log Helpers ============

export interface JobLogData {
  id: string;
  dataObject: string;
  jobType: string;
  status: string;
  itemsProcessed: number;
  itemsSucceeded: number;
  itemsFailed: number;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

/**
 * Create a new job log entry
 */
export async function createJobLog(
  dataObject: DataObjectName,
  jobType: 'sync' | 'webhook'
): Promise<string> {
  const db = getDb();
  
  const job = await db.jobLog.create({
    data: {
      dataObject,
      jobType,
      status: 'queued',
    },
  });

  return job.id;
}

/**
 * Update job log status
 */
export async function updateJobLog(
  jobId: string,
  updates: Partial<Omit<JobLogData, 'id' | 'dataObject' | 'jobType'>>
): Promise<void> {
  const db = getDb();
  
  await db.jobLog.update({
    where: { id: jobId },
    data: updates,
  });
}

/**
 * Mark a job as started
 */
export async function markJobStarted(jobId: string): Promise<void> {
  await updateJobLog(jobId, {
    status: 'running',
    startedAt: new Date(),
  });
}

/**
 * Mark a job as completed
 */
export async function markJobCompleted(
  jobId: string,
  stats: { processed: number; succeeded: number; failed: number }
): Promise<void> {
  await updateJobLog(jobId, {
    status: 'completed',
    completedAt: new Date(),
    itemsProcessed: stats.processed,
    itemsSucceeded: stats.succeeded,
    itemsFailed: stats.failed,
  });
}

/**
 * Mark a job as failed
 */
export async function markJobFailed(
  jobId: string,
  errorMessage: string
): Promise<void> {
  await updateJobLog(jobId, {
    status: 'failed',
    completedAt: new Date(),
    errorMessage,
  });
}

/**
 * Get recent job logs for a data object
 */
export async function getRecentJobLogs(
  dataObject: DataObjectName,
  limit: number = 10
): Promise<JobLogData[]> {
  const db = getDb();
  
  return db.jobLog.findMany({
    where: { dataObject },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

// ============ Webhook Event Helpers ============

/**
 * Store a webhook event for processing
 */
export async function storeWebhookEvent(
  topic: string,
  shopifyId: string,
  payload: Record<string, unknown>
): Promise<string> {
  const db = getDb();
  
  const event = await db.webhookEvent.create({
    data: {
      topic,
      shopifyId,
      payload: JSON.stringify(payload),
    },
  });

  return event.id;
}

/**
 * Get unprocessed webhook events
 */
export async function getUnprocessedWebhooks(
  topic?: string,
  limit: number = 100
): Promise<Array<{
  id: string;
  topic: string;
  shopifyId: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}>> {
  const db = getDb();
  
  const events = await db.webhookEvent.findMany({
    where: {
      processed: false,
      ...(topic && { topic }),
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  return events.map(e => ({
    id: e.id,
    topic: e.topic,
    shopifyId: e.shopifyId,
    payload: JSON.parse(e.payload) as Record<string, unknown>,
    createdAt: e.createdAt,
  }));
}

/**
 * Mark a webhook event as processed
 */
export async function markWebhookProcessed(eventId: string): Promise<void> {
  const db = getDb();
  
  await db.webhookEvent.update({
    where: { id: eventId },
    data: {
      processed: true,
      processedAt: new Date(),
    },
  });
}

/**
 * Clean up old processed webhook events
 */
export async function cleanupOldWebhooks(olderThanDays: number = 7): Promise<number> {
  const db = getDb();
  
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - olderThanDays);

  const result = await db.webhookEvent.deleteMany({
    where: {
      processed: true,
      processedAt: { lt: cutoff },
    },
  });

  return result.count;
}
