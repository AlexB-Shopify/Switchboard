#!/usr/bin/env node
/**
 * Switchboard - Shopify Integration Layer
 * Main entry point and CLI
 */

import 'dotenv/config';
import { Command } from 'commander';
import { configManager, type RunMode } from './config';
import { logger } from './core/logger';
import { scheduler } from './core/scheduler';
import { webhookServer } from './core/webhookServer';
import { jobQueue } from './core/queue';
import { initDb, closeDb, resetDb } from './db/client';
import { sheetsClient } from './integrations/googleSheets/client';
import { syncWebhooks } from './integrations/shopify/webhooks';
import { registerHandlers } from './handlers';

/**
 * Application state
 */
let isShuttingDown = false;

/**
 * Graceful shutdown handler
 */
async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.shutdown();
  logger.info(`Received ${signal}, shutting down...`);

  try {
    // Stop accepting new jobs
    scheduler.stop();

    // Wait for queue to finish (with timeout)
    logger.info('Waiting for pending jobs to complete...');
    const queueDrained = await jobQueue.waitForIdle(30000);
    
    if (!queueDrained) {
      logger.warn('Timeout waiting for jobs, forcing shutdown');
      jobQueue.clear();
    }

    // Stop webhook server
    await webhookServer.stop();

    // Close database connection
    await closeDb();

    logger.info('Shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error(`Error during shutdown: ${error}`);
    process.exit(1);
  }
}

/**
 * Initialize the application
 */
async function initialize(mode: RunMode): Promise<void> {
  // Load configuration
  const config = configManager.load(mode);
  
  // Set log level based on mode
  if (mode === 'demo') {
    logger.setLevel('debug');
  }

  // Initialize database
  await initDb();
  
  // Reset database in demo mode
  if (mode === 'demo') {
    await resetDb();
    logger.dbInitialized(true);
  } else {
    logger.dbInitialized(false);
  }

  // Initialize Google Sheets client
  await sheetsClient.initialize();

  // Register handlers with job queue
  registerHandlers();

  // Log enabled objects
  const enabledObjects = configManager.getEnabledDataObjects();
  logger.configLoaded(enabledObjects);
}

/**
 * Start the daemon
 */
async function startDaemon(options: { demo?: boolean; production?: boolean }): Promise<void> {
  // Determine mode
  let mode: RunMode = 'demo';
  if (options.production) {
    mode = 'production';
  } else if (options.demo) {
    mode = 'demo';
  }

  try {
    // Initialize
    await initialize(mode);

    const config = configManager.get();

    // Start webhook server
    await webhookServer.start();

    // Log startup
    logger.startup(mode, config.webhookPort);

    // Register webhooks with Shopify (if base URL is available)
    const webhookBaseUrl = process.env.WEBHOOK_BASE_URL;
    if (webhookBaseUrl) {
      try {
        const { registered, deleted } = await syncWebhooks(webhookBaseUrl);
        if (registered.length > 0) {
          logger.info(`Registered webhooks: ${registered.join(', ')}`);
        }
        if (deleted.length > 0) {
          logger.info(`Deleted obsolete webhooks: ${deleted.join(', ')}`);
        }
      } catch (error) {
        logger.warn(`Failed to sync webhooks: ${error}`);
      }
    } else {
      logger.info('WEBHOOK_BASE_URL not set, skipping webhook registration');
      logger.info('Set WEBHOOK_BASE_URL to enable automatic webhook registration');
    }

    // Start scheduler
    scheduler.start();

    // Trigger initial sync for all cron-based objects
    scheduler.triggerAllSyncs();

    // Set up signal handlers for graceful shutdown
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Keep the process running
    logger.info('Switchboard is running. Press Ctrl+C to stop.');

  } catch (error) {
    logger.error(`Failed to start: ${error}`);
    process.exit(1);
  }
}

/**
 * Trigger a manual sync
 */
async function triggerSync(dataObject: string, options: { demo?: boolean; production?: boolean }): Promise<void> {
  // Determine mode
  let mode: RunMode = 'demo';
  if (options.production) {
    mode = 'production';
  }

  try {
    await initialize(mode);

    const enabledObjects = configManager.getEnabledDataObjects();
    
    if (!enabledObjects.includes(dataObject as any)) {
      logger.error(`Data object '${dataObject}' is not enabled`);
      process.exit(1);
    }

    // Register handlers
    registerHandlers();

    logger.info(`Triggering sync for ${dataObject}`);
    scheduler.triggerImmediateSync(dataObject as any);

    // Wait for job to complete
    await jobQueue.waitForIdle(300000); // 5 minute timeout

    await closeDb();
    process.exit(0);
  } catch (error) {
    logger.error(`Sync failed: ${error}`);
    process.exit(1);
  }
}

/**
 * Show status
 */
async function showStatus(options: { demo?: boolean; production?: boolean }): Promise<void> {
  // Determine mode
  let mode: RunMode = 'demo';
  if (options.production) {
    mode = 'production';
  }

  try {
    configManager.load(mode);
    
    const config = configManager.get();
    const enabledObjects = configManager.getEnabledDataObjects();

    console.log('\nSwitchboard Status');
    console.log('==================');
    console.log(`Mode: ${config.mode}`);
    console.log(`Webhook Port: ${config.webhookPort}`);
    console.log(`\nEnabled Data Objects:`);
    
    for (const name of enabledObjects) {
      const objConfig = configManager.getDataObject(name);
      const schedule = configManager.getActiveSchedule(name);
      
      console.log(`  - ${name}`);
      console.log(`    Direction: ${objConfig.direction}`);
      console.log(`    Trigger: ${objConfig.trigger}`);
      if (schedule) {
        console.log(`    Schedule: ${schedule}`);
      }
      if (objConfig.dependencies?.length) {
        console.log(`    Dependencies: ${objConfig.dependencies.join(', ')}`);
      }
    }

    console.log('\n');
  } catch (error) {
    logger.error(`Failed to get status: ${error}`);
    process.exit(1);
  }
}

// Set up CLI
const program = new Command();

program
  .name('switchboard')
  .description('Shopify Integration Layer - Keep your store in sync with your ERP')
  .version('1.0.0');

program
  .command('start')
  .description('Start the Switchboard daemon')
  .option('--demo', 'Run in demo mode (compressed timelines, reset database)')
  .option('--production', 'Run in production mode')
  .action(startDaemon);

program
  .command('sync <dataObject>')
  .description('Trigger a manual sync for a specific data object')
  .option('--demo', 'Run in demo mode')
  .option('--production', 'Run in production mode')
  .action(triggerSync);

program
  .command('status')
  .description('Show configuration status')
  .option('--demo', 'Show demo configuration')
  .option('--production', 'Show production configuration')
  .action(showStatus);

// Parse arguments
program.parse();

// If no command provided, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
