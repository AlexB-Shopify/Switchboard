/**
 * Webhook Server
 * Express server for receiving and processing Shopify webhooks
 */

import express, { Request, Response, NextFunction } from 'express';
import { configManager, type DataObjectName } from '../config';
import { logger } from './logger';
import { jobQueue, JobPriority } from './queue';
import { verifyWebhookSignature, extractResourceId } from '../integrations/shopify/webhooks';
import { storeWebhookEvent } from '../db/client';

/**
 * Extend Request to include raw body
 */
interface WebhookRequest extends Request {
  rawBody?: Buffer;
}

/**
 * Map webhook topics to data objects
 */
const topicToDataObject: Record<string, DataObjectName> = {
  'orders/create': 'orders',
  'orders/updated': 'orders',
  'orders/cancelled': 'orders',
  'orders/fulfilled': 'orders',
  'orders/paid': 'orders',
  'customers/create': 'customers',
  'customers/update': 'customers',
  'customers/delete': 'customers',
  'products/create': 'products',
  'products/update': 'products',
  'products/delete': 'products',
  'inventory_levels/update': 'inventory',
};

/**
 * Webhook Server class
 */
export class WebhookServer {
  private app: express.Application;
  private server: ReturnType<typeof this.app.listen> | null = null;
  private port: number;

  constructor() {
    this.app = express();
    this.port = 3000;
    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Set up Express middleware
   */
  private setupMiddleware(): void {
    // Capture raw body for HMAC verification
    this.app.use(express.json({
      verify: (req: WebhookRequest, _res, buf) => {
        req.rawBody = buf;
      },
    }));

    // Request logging
    this.app.use((req: Request, _res: Response, next: NextFunction) => {
      logger.debug(`${req.method} ${req.path}`);
      next();
    });
  }

  /**
   * Set up routes
   */
  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Status endpoint
    this.app.get('/status', (_req: Request, res: Response) => {
      const queueStatus = jobQueue.getStatus();
      res.json({
        status: 'ok',
        mode: configManager.get().mode,
        queue: queueStatus,
        timestamp: new Date().toISOString(),
      });
    });

    // Generic webhook endpoint for all topics
    this.app.post('/webhooks/:topic', this.handleWebhook.bind(this));

    // Alternative webhook endpoint format
    this.app.post('/webhooks', this.handleGenericWebhook.bind(this));

    // 404 handler
    this.app.use((_req: Request, res: Response) => {
      res.status(404).json({ error: 'Not found' });
    });

    // Error handler
    this.app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      logger.error(`Server error: ${err.message}`);
      res.status(500).json({ error: 'Internal server error' });
    });
  }

  /**
   * Handle webhook by topic parameter
   */
  private async handleWebhook(req: WebhookRequest, res: Response): Promise<void> {
    const topicParam = req.params.topic;
    // Convert topic param back to Shopify format (orders-create -> orders/create)
    const topic = String(topicParam).replace('-', '/');

    await this.processWebhook(req, res, topic);
  }

  /**
   * Handle generic webhook (topic from headers)
   */
  private async handleGenericWebhook(req: WebhookRequest, res: Response): Promise<void> {
    const topic = req.headers['x-shopify-topic'] as string;
    
    if (!topic) {
      res.status(400).json({ error: 'Missing X-Shopify-Topic header' });
      return;
    }

    await this.processWebhook(req, res, topic);
  }

  /**
   * Process a webhook
   */
  private async processWebhook(
    req: WebhookRequest,
    res: Response,
    topic: string
  ): Promise<void> {
    // Verify HMAC signature
    const hmacHeader = req.headers['x-shopify-hmac-sha256'] as string;
    
    if (hmacHeader && req.rawBody) {
      const isValid = verifyWebhookSignature(req.rawBody, hmacHeader);
      
      if (!isValid) {
        logger.warn(`Invalid webhook signature for topic: ${topic}`);
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    }

    // Get the payload
    const payload = req.body as Record<string, unknown>;

    // Log the webhook
    let shopifyId: string;
    try {
      shopifyId = extractResourceId(topic, payload);
    } catch {
      shopifyId = String(payload.id || 'unknown');
    }

    logger.webhookReceived(topic, shopifyId);

    // Find the data object for this topic
    const dataObject = topicToDataObject[topic];
    
    if (!dataObject) {
      logger.warn(`Unknown webhook topic: ${topic}`);
      // Still return 200 to acknowledge receipt
      res.status(200).json({ received: true, processed: false, reason: 'unknown topic' });
      return;
    }

    // Check if the data object is enabled and set to webhook trigger
    const config = configManager.getDataObject(dataObject);
    
    if (!config.enabled) {
      logger.debug(`Webhook for disabled data object: ${dataObject}`);
      res.status(200).json({ received: true, processed: false, reason: 'data object disabled' });
      return;
    }

    if (config.trigger !== 'webhook') {
      logger.debug(`Webhook received for non-webhook triggered data object: ${dataObject}`);
      res.status(200).json({ received: true, processed: false, reason: 'not webhook triggered' });
      return;
    }

    try {
      // Store the webhook event
      const eventId = await storeWebhookEvent(topic, shopifyId, payload);

      // Enqueue a job to process this webhook
      jobQueue.enqueue(dataObject, 'webhook', {
        priority: JobPriority.HIGH,
        payload: {
          eventId,
          topic,
          shopifyId,
          data: payload,
        },
      });

      res.status(200).json({ received: true, processed: true, eventId });
    } catch (error) {
      logger.error(`Failed to process webhook: ${error}`);
      // Still return 200 to prevent Shopify retries
      res.status(200).json({ received: true, processed: false, error: 'processing failed' });
    }
  }

  /**
   * Start the server
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const config = configManager.get();
        this.port = config.webhookPort;

        this.server = this.app.listen(this.port, () => {
          logger.info(`Webhook server listening on port ${this.port}`);
          resolve();
        });

        this.server.on('error', (error: Error) => {
          logger.error(`Webhook server error: ${error.message}`);
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop the server
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.info('Webhook server stopped');
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Get the Express app (for testing)
   */
  getApp(): express.Application {
    return this.app;
  }

  /**
   * Get the server URL
   */
  getUrl(): string {
    return `http://localhost:${this.port}`;
  }
}

// Export singleton instance
export const webhookServer = new WebhookServer();
