/**
 * Job Queue
 * Priority queue with dependency management for sync jobs
 */

import { EventEmitter } from 'events';
import type { DataObjectName } from '../config';
import { logger } from './logger';
import { isSyncRunning } from '../db/client';

/**
 * Job priority levels
 */
export enum JobPriority {
  HIGH = 0,    // Webhooks, urgent updates
  NORMAL = 1,  // Scheduled syncs
  LOW = 2,     // Background tasks, cleanup
}

/**
 * Job status
 */
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Job definition
 */
export interface Job {
  id: string;
  dataObject: DataObjectName;
  type: 'sync' | 'webhook';
  priority: JobPriority;
  status: JobStatus;
  dependencies: DataObjectName[];
  payload?: Record<string, unknown>;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

/**
 * Job handler function type
 */
export type JobHandler = (job: Job) => Promise<void>;

/**
 * Job Queue class
 */
export class JobQueue extends EventEmitter {
  private queue: Job[] = [];
  private running: Map<string, Job> = new Map();
  private handlers: Map<DataObjectName, JobHandler> = new Map();
  private maxConcurrent: number = 1;
  private processing: boolean = false;
  private jobCounter: number = 0;

  constructor(maxConcurrent: number = 1) {
    super();
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * Register a handler for a data object type
   */
  registerHandler(dataObject: DataObjectName, handler: JobHandler): void {
    this.handlers.set(dataObject, handler);
  }

  /**
   * Generate a unique job ID
   */
  private generateJobId(): string {
    this.jobCounter++;
    return `job_${Date.now()}_${this.jobCounter}`;
  }

  /**
   * Add a job to the queue
   */
  enqueue(
    dataObject: DataObjectName,
    type: 'sync' | 'webhook',
    options: {
      priority?: JobPriority;
      dependencies?: DataObjectName[];
      payload?: Record<string, unknown>;
    } = {}
  ): string {
    const job: Job = {
      id: this.generateJobId(),
      dataObject,
      type,
      priority: options.priority ?? JobPriority.NORMAL,
      status: 'queued',
      dependencies: options.dependencies ?? [],
      payload: options.payload,
      createdAt: new Date(),
    };

    // Check if already queued or running
    const existing = this.findJob(dataObject, type);
    if (existing) {
      logger.debug(`Job for ${dataObject} already in queue, skipping`, { dataObject });
      return existing.id;
    }

    // Insert in priority order
    let inserted = false;
    for (let i = 0; i < this.queue.length; i++) {
      if (this.queue[i].priority > job.priority) {
        this.queue.splice(i, 0, job);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      this.queue.push(job);
    }

    logger.debug(`Job queued: ${job.id}`, { dataObject });
    this.emit('job:queued', job);

    // Trigger processing
    this.processNext();

    return job.id;
  }

  /**
   * Find an existing job for a data object
   */
  private findJob(dataObject: DataObjectName, type: 'sync' | 'webhook'): Job | undefined {
    // Check queue
    const queued = this.queue.find(j => j.dataObject === dataObject && j.type === type);
    if (queued) return queued;

    // Check running
    for (const job of this.running.values()) {
      if (job.dataObject === dataObject && job.type === type) {
        return job;
      }
    }

    return undefined;
  }

  /**
   * Check if dependencies are satisfied
   */
  private async areDependenciesSatisfied(job: Job): Promise<boolean> {
    for (const dep of job.dependencies) {
      // Check if dependency is currently running
      if (await isSyncRunning(dep)) {
        return false;
      }

      // Check if dependency is queued with higher or equal priority
      const depJob = this.queue.find(j => j.dataObject === dep);
      if (depJob && depJob.priority <= job.priority) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get the next job that can be processed
   */
  private async getNextJob(): Promise<Job | null> {
    for (let i = 0; i < this.queue.length; i++) {
      const job = this.queue[i];
      
      // Check if dependencies are satisfied
      if (await this.areDependenciesSatisfied(job)) {
        // Remove from queue
        this.queue.splice(i, 1);
        return job;
      }
    }
    return null;
  }

  /**
   * Process the next job in the queue
   */
  private async processNext(): Promise<void> {
    // Prevent concurrent processing
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.running.size < this.maxConcurrent && this.queue.length > 0) {
        const job = await this.getNextJob();
        if (!job) break;

        // Start job
        this.startJob(job);
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Start processing a job
   */
  private async startJob(job: Job): Promise<void> {
    const handler = this.handlers.get(job.dataObject);
    if (!handler) {
      logger.error(`No handler registered for ${job.dataObject}`, { dataObject: job.dataObject });
      job.status = 'failed';
      job.error = 'No handler registered';
      this.emit('job:failed', job);
      return;
    }

    job.status = 'running';
    job.startedAt = new Date();
    this.running.set(job.id, job);
    
    logger.debug(`Job started: ${job.id}`, { dataObject: job.dataObject });
    this.emit('job:started', job);

    try {
      await handler(job);
      
      job.status = 'completed';
      job.completedAt = new Date();
      
      logger.debug(`Job completed: ${job.id}`, { dataObject: job.dataObject });
      this.emit('job:completed', job);
    } catch (error) {
      job.status = 'failed';
      job.completedAt = new Date();
      job.error = error instanceof Error ? error.message : String(error);
      
      logger.error(`Job failed: ${job.id} - ${job.error}`, { dataObject: job.dataObject });
      this.emit('job:failed', job);
    } finally {
      this.running.delete(job.id);
      
      // Process next job
      this.processNext();
    }
  }

  /**
   * Cancel a job by ID
   */
  cancel(jobId: string): boolean {
    const index = this.queue.findIndex(j => j.id === jobId);
    if (index >= 0) {
      const job = this.queue[index];
      job.status = 'cancelled';
      this.queue.splice(index, 1);
      this.emit('job:cancelled', job);
      return true;
    }
    return false;
  }

  /**
   * Cancel all jobs for a data object
   */
  cancelAll(dataObject: DataObjectName): number {
    let cancelled = 0;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].dataObject === dataObject) {
        this.queue[i].status = 'cancelled';
        this.emit('job:cancelled', this.queue[i]);
        this.queue.splice(i, 1);
        cancelled++;
      }
    }
    return cancelled;
  }

  /**
   * Get queue status
   */
  getStatus(): {
    queued: number;
    running: number;
    jobs: Array<{ id: string; dataObject: string; status: JobStatus; priority: JobPriority }>;
  } {
    const jobs = [
      ...this.queue.map(j => ({
        id: j.id,
        dataObject: j.dataObject,
        status: j.status,
        priority: j.priority,
      })),
      ...Array.from(this.running.values()).map(j => ({
        id: j.id,
        dataObject: j.dataObject,
        status: j.status,
        priority: j.priority,
      })),
    ];

    return {
      queued: this.queue.length,
      running: this.running.size,
      jobs,
    };
  }

  /**
   * Check if the queue is idle
   */
  isIdle(): boolean {
    return this.queue.length === 0 && this.running.size === 0;
  }

  /**
   * Wait for the queue to become idle
   */
  async waitForIdle(timeoutMs: number = 60000): Promise<boolean> {
    if (this.isIdle()) return true;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve(false);
      }, timeoutMs);

      const checkIdle = () => {
        if (this.isIdle()) {
          cleanup();
          resolve(true);
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.off('job:completed', checkIdle);
        this.off('job:failed', checkIdle);
        this.off('job:cancelled', checkIdle);
      };

      this.on('job:completed', checkIdle);
      this.on('job:failed', checkIdle);
      this.on('job:cancelled', checkIdle);
    });
  }

  /**
   * Clear all queued jobs
   */
  clear(): void {
    for (const job of this.queue) {
      job.status = 'cancelled';
      this.emit('job:cancelled', job);
    }
    this.queue = [];
  }
}

// Export singleton instance
export const jobQueue = new JobQueue();
