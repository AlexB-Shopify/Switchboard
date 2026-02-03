/**
 * Shopify Webhook Management
 * Registration and HMAC verification for Shopify webhooks
 */

import * as crypto from 'crypto';
import { shopifyClient, type UserError } from './client';
import { configManager } from '../../config';
import { logger } from '../../core/logger';

/**
 * Webhook subscription info
 */
export interface WebhookSubscription {
  id: string;
  topic: string;
  endpoint: { callbackUrl: string };
  format: string;
}

/**
 * Verify webhook HMAC signature
 */
export function verifyWebhookSignature(
  body: string | Buffer,
  hmacHeader: string
): boolean {
  const secret = configManager.getWebhookSecret();
  if (!secret) {
    logger.warn('No webhook secret configured, skipping verification');
    return true; // Allow in development
  }

  const bodyString = typeof body === 'string' ? body : body.toString('utf8');
  const hash = crypto
    .createHmac('sha256', secret)
    .update(bodyString, 'utf8')
    .digest('base64');

  return crypto.timingSafeEqual(
    Buffer.from(hash),
    Buffer.from(hmacHeader)
  );
}

/**
 * Get all registered webhooks
 */
export async function getWebhookSubscriptions(): Promise<WebhookSubscription[]> {
  const query = `
    query GetWebhooks {
      webhookSubscriptions(first: 50) {
        edges {
          node {
            id
            topic
            endpoint {
              ... on WebhookHttpEndpoint {
                callbackUrl
              }
            }
            format
          }
        }
      }
    }
  `;

  const data = await shopifyClient.graphql<{
    webhookSubscriptions: {
      edges: Array<{ node: WebhookSubscription }>;
    };
  }>(query);

  return data.webhookSubscriptions.edges.map(e => e.node);
}

/**
 * Register a webhook subscription
 */
export async function registerWebhook(
  topic: string,
  callbackUrl: string
): Promise<WebhookSubscription> {
  const mutation = `
    mutation RegisterWebhook($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
      webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
        webhookSubscription {
          id
          topic
          endpoint {
            ... on WebhookHttpEndpoint {
              callbackUrl
            }
          }
          format
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  // Convert topic string to GraphQL enum format (e.g., "orders/create" -> "ORDERS_CREATE")
  const topicEnum = topic.toUpperCase().replace('/', '_');

  const data = await shopifyClient.graphql<{
    webhookSubscriptionCreate: {
      webhookSubscription: WebhookSubscription | null;
      userErrors: UserError[];
    };
  }>(mutation, {
    topic: topicEnum,
    webhookSubscription: {
      callbackUrl,
      format: 'JSON',
    },
  });

  shopifyClient.checkUserErrors(data.webhookSubscriptionCreate.userErrors, 'registerWebhook');
  return data.webhookSubscriptionCreate.webhookSubscription!;
}

/**
 * Delete a webhook subscription
 */
export async function deleteWebhook(id: string): Promise<void> {
  const mutation = `
    mutation DeleteWebhook($id: ID!) {
      webhookSubscriptionDelete(id: $id) {
        deletedWebhookSubscriptionId
        userErrors {
          field
          message
        }
      }
    }
  `;

  const data = await shopifyClient.graphql<{
    webhookSubscriptionDelete: {
      deletedWebhookSubscriptionId: string | null;
      userErrors: UserError[];
    };
  }>(mutation, { id });

  shopifyClient.checkUserErrors(data.webhookSubscriptionDelete.userErrors, 'deleteWebhook');
}

/**
 * Sync webhooks - register required webhooks and remove obsolete ones
 */
export async function syncWebhooks(baseUrl: string): Promise<{
  registered: string[];
  deleted: string[];
}> {
  const config = configManager.get();
  const registered: string[] = [];
  const deleted: string[] = [];

  // Collect all required webhook topics from enabled data objects
  const requiredTopics = new Set<string>();
  
  for (const [name, objConfig] of Object.entries(config.dataObjects)) {
    if (objConfig.enabled && objConfig.trigger === 'webhook' && objConfig.webhookTopics) {
      for (const topic of objConfig.webhookTopics) {
        requiredTopics.add(topic);
      }
    }
  }

  // Get existing webhooks
  const existingWebhooks = await getWebhookSubscriptions();
  const existingTopics = new Map<string, WebhookSubscription>();
  
  for (const webhook of existingWebhooks) {
    // Convert topic back to lowercase format for comparison
    const topicLower = webhook.topic.toLowerCase().replace('_', '/');
    existingTopics.set(topicLower, webhook);
  }

  // Register missing webhooks
  for (const topic of requiredTopics) {
    const callbackUrl = `${baseUrl}/webhooks/${topic.replace('/', '-')}`;
    
    if (!existingTopics.has(topic)) {
      try {
        await registerWebhook(topic, callbackUrl);
        registered.push(topic);
        logger.info(`Registered webhook: ${topic}`);
      } catch (error) {
        logger.error(`Failed to register webhook ${topic}: ${error}`);
      }
    } else {
      // Check if callback URL needs updating
      const existing = existingTopics.get(topic)!;
      if (existing.endpoint.callbackUrl !== callbackUrl) {
        try {
          await deleteWebhook(existing.id);
          await registerWebhook(topic, callbackUrl);
          registered.push(topic);
          logger.info(`Updated webhook: ${topic}`);
        } catch (error) {
          logger.error(`Failed to update webhook ${topic}: ${error}`);
        }
      }
    }
  }

  // Delete obsolete webhooks (only if they were created by us)
  for (const [topic, webhook] of existingTopics) {
    if (!requiredTopics.has(topic) && webhook.endpoint.callbackUrl.includes('/webhooks/')) {
      try {
        await deleteWebhook(webhook.id);
        deleted.push(topic);
        logger.info(`Deleted webhook: ${topic}`);
      } catch (error) {
        logger.error(`Failed to delete webhook ${topic}: ${error}`);
      }
    }
  }

  return { registered, deleted };
}

/**
 * Extract resource ID from webhook payload
 */
export function extractResourceId(topic: string, payload: Record<string, unknown>): string {
  // Shopify webhook payloads typically have the resource ID at the top level
  if (payload.id) {
    return `gid://shopify/${getResourceType(topic)}/${payload.id}`;
  }
  
  // Some webhooks have admin_graphql_api_id
  if (payload.admin_graphql_api_id) {
    return payload.admin_graphql_api_id as string;
  }

  throw new Error(`Could not extract resource ID from webhook payload for topic ${topic}`);
}

/**
 * Get resource type from webhook topic
 */
function getResourceType(topic: string): string {
  const resourceMap: Record<string, string> = {
    'orders/create': 'Order',
    'orders/updated': 'Order',
    'orders/cancelled': 'Order',
    'orders/fulfilled': 'Order',
    'orders/paid': 'Order',
    'customers/create': 'Customer',
    'customers/update': 'Customer',
    'customers/delete': 'Customer',
    'products/create': 'Product',
    'products/update': 'Product',
    'products/delete': 'Product',
    'inventory_levels/update': 'InventoryLevel',
    'fulfillments/create': 'Fulfillment',
    'fulfillments/update': 'Fulfillment',
  };

  return resourceMap[topic] || 'Unknown';
}
