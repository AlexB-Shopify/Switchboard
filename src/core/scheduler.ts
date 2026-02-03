/**
 * Job Scheduler
 * Heartbeat-based scheduler with cron support for triggering sync jobs
 */

import * as cron from 'node-cron';
import { configManager, type DataObjectName } from '../config';
import { jobQueue, JobPriority } from './queue';
import { logger } from './logger';
import { isSyncRunning, getSyncState } from '../db/client';

/**
 * Cron task wrapper
 */
interface ScheduledTask {
  dataObject: DataObjectName;
  cronExpression: string;
  task: cron.ScheduledTask;
}

/**
 * Scheduler class
 */
export class Scheduler {
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private scheduledTasks: Map<DataObjectName, ScheduledTask> = new Map();
  private isRunning: boolean = false;

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('Scheduler is already running');
      return;
    }

    const config = configManager.get();
    this.isRunning = true;

    // Set up cron schedules for each enabled data object
    this.setupCronSchedules();

    // Start heartbeat
    this.startHeartbeat(config.heartbeatIntervalMs);

    logger.info('Scheduler started');
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (!this.isRunning) return;

    // Stop heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Stop all cron tasks
    for (const task of this.scheduledTasks.values()) {
      task.task.stop();
    }
    this.scheduledTasks.clear();

    this.isRunning = false;
    logger.info('Scheduler stopped');
  }

  /**
   * Set up cron schedules for all enabled data objects
   */
  private setupCronSchedules(): void {
    const enabledObjects = configManager.getEnabledDataObjects();

    for (const dataObject of enabledObjects) {
      const objConfig = configManager.getDataObject(dataObject);
      
      // Only set up cron for cron-triggered objects
      if (objConfig.trigger !== 'cron') continue;

      const cronExpression = configManager.getActiveSchedule(dataObject);
      if (!cronExpression) continue;

      // Validate cron expression
      if (!cron.validate(cronExpression)) {
        logger.error(`Invalid cron expression for ${dataObject}: ${cronExpression}`, { dataObject });
        continue;
      }

      // Create cron task
      const task = cron.schedule(cronExpression, () => {
        this.triggerSync(dataObject);
      }, {
        scheduled: true,
        runOnInit: false, // Don't run immediately on start
      });

      this.scheduledTasks.set(dataObject, {
        dataObject,
        cronExpression,
        task,
      });

      logger.debug(`Scheduled ${dataObject} with cron: ${cronExpression}`, { dataObject });
    }
  }

  /**
   * Start the heartbeat timer
   */
  private startHeartbeat(intervalMs: number): void {
    this.heartbeatInterval = setInterval(() => {
      this.heartbeat();
    }, intervalMs);

    // Run initial heartbeat
    this.heartbeat();
  }

  /**
   * Heartbeat function - checks for stuck jobs and logs status
   */
  private async heartbeat(): Promise<void> {
    const status = jobQueue.getStatus();
    
    // Log heartbeat with queue status if there are jobs
    if (status.queued > 0 || status.running > 0) {
      logger.debug(`Heartbeat: ${status.running} running, ${status.queued} queued`);
    }

    // Check for stuck syncs (running for too long)
    await this.checkStuckSyncs();
  }

  /**
   * Check for syncs that have been running too long
   */
  private async checkStuckSyncs(): Promise<void> {
    const enabledObjects = configManager.getEnabledDataObjects();
    const maxRunningTimeMs = 10 * 60 * 1000; // 10 minutes

    for (const dataObject of enabledObjects) {
      const state = await getSyncState(dataObject);
      
      if (state.status === 'running' && state.lastSyncAt) {
        const runningTime = Date.now() - state.lastSyncAt.getTime();
        
        if (runningTime > maxRunningTimeMs) {
          logger.warn(
            `Sync appears stuck (running for ${Math.round(runningTime / 1000)}s)`,
            { dataObject }
          );
        }
      }
    }
  }

  /**
   * Trigger a sync for a data object
   */
  triggerSync(dataObject: DataObjectName): void {
    const objConfig = configManager.getDataObject(dataObject);
    
    if (!objConfig.enabled) {
      logger.debug(`Skipping disabled data object: ${dataObject}`, { dataObject });
      return;
    }

    // Get dependencies
    const dependencies = (objConfig.dependencies || []) as DataObjectName[];

    // Enqueue the sync job
    jobQueue.enqueue(dataObject, 'sync', {
      priority: JobPriority.NORMAL,
      dependencies,
    });
  }

  /**
   * Trigger an immediate sync for a data object (bypasses schedule)
   */
  triggerImmediateSync(dataObject: DataObjectName): void {
    const objConfig = configManager.getDataObject(dataObject);
    
    if (!objConfig.enabled) {
      logger.warn(`Cannot trigger sync for disabled data object: ${dataObject}`, { dataObject });
      return;
    }

    // Get dependencies
    const dependencies = (objConfig.dependencies || []) as DataObjectName[];

    // Enqueue with high priority
    jobQueue.enqueue(dataObject, 'sync', {
      priority: JobPriority.HIGH,
      dependencies,
    });

    logger.info(`Immediate sync triggered`, { dataObject });
  }

  /**
   * Trigger syncs for all enabled data objects (useful for initial sync)
   */
  triggerAllSyncs(): void {
    const enabledObjects = configManager.getEnabledDataObjects();
    
    for (const dataObject of enabledObjects) {
      const objConfig = configManager.getDataObject(dataObject);
      
      // Only trigger cron-based syncs
      if (objConfig.trigger === 'cron') {
        this.triggerSync(dataObject);
      }
    }

    logger.info('Triggered initial sync for all cron-based data objects');
  }

  /**
   * Get scheduler status
   */
  getStatus(): {
    isRunning: boolean;
    scheduledTasks: Array<{ dataObject: DataObjectName; cronExpression: string }>;
    queueStatus: ReturnType<typeof jobQueue.getStatus>;
  } {
    return {
      isRunning: this.isRunning,
      scheduledTasks: Array.from(this.scheduledTasks.values()).map(t => ({
        dataObject: t.dataObject,
        cronExpression: t.cronExpression,
      })),
      queueStatus: jobQueue.getStatus(),
    };
  }

  /**
   * Update schedule for a data object (useful for runtime config changes)
   */
  updateSchedule(dataObject: DataObjectName): void {
    // Stop existing task if any
    const existing = this.scheduledTasks.get(dataObject);
    if (existing) {
      existing.task.stop();
      this.scheduledTasks.delete(dataObject);
    }

    const objConfig = configManager.getDataObject(dataObject);
    
    if (!objConfig.enabled || objConfig.trigger !== 'cron') return;

    const cronExpression = configManager.getActiveSchedule(dataObject);
    if (!cronExpression || !cron.validate(cronExpression)) return;

    // Create new cron task
    const task = cron.schedule(cronExpression, () => {
      this.triggerSync(dataObject);
    }, {
      scheduled: true,
      runOnInit: false,
    });

    this.scheduledTasks.set(dataObject, {
      dataObject,
      cronExpression,
      task,
    });

    logger.info(`Schedule updated: ${cronExpression}`, { dataObject });
  }
}

// Export singleton instance
export const scheduler = new Scheduler();
