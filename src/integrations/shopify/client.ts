/**
 * Shopify Admin API Client
 * Refactored from newAuth.ts - Uses Client Credentials Grant flow
 */

import { configManager } from '../../config';
import { logger } from '../../core/logger';

// ============ Types & Interfaces ============

interface TokenResponse {
  access_token: string;
  scope: string;
  expires_in: number;
}

export interface GraphQLResponse<T = unknown> {
  data?: T;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: string[];
    extensions?: Record<string, unknown>;
  }>;
  extensions?: {
    cost?: {
      requestedQueryCost: number;
      actualQueryCost: number;
      throttleStatus: {
        maximumAvailable: number;
        currentlyAvailable: number;
        restoreRate: number;
      };
    };
  };
}

export interface UserError {
  field: string[];
  message: string;
  code?: string;
}

export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor?: string;
  endCursor?: string;
}

export interface Connection<T> {
  edges: Array<{ node: T; cursor: string }>;
  pageInfo: PageInfo;
}

// ============ Shopify Client Class ============

export class ShopifyClient {
  private accessToken: string | null = null;
  private tokenExpiresAt: Date | null = null;

  /**
   * Get shop URL from config
   */
  private get shopUrl(): string {
    const config = configManager.get();
    let domain = config.shopify.storeDomain;
    if (domain.endsWith('.myshopify.com')) {
      domain = domain.replace('.myshopify.com', '');
    }
    return `https://${domain}.myshopify.com`;
  }

  /**
   * Get GraphQL API URL
   */
  private get graphqlUrl(): string {
    const config = configManager.get();
    return `${this.shopUrl}/admin/api/${config.shopify.apiVersion}/graphql.json`;
  }

  /**
   * Get token URL
   */
  private get tokenUrl(): string {
    return `${this.shopUrl}/admin/oauth/access_token`;
  }

  /**
   * Get a valid access token, refreshing if necessary
   */
  private async getAccessToken(): Promise<string> {
    // Check if we have a valid token (with 5 min buffer)
    if (this.accessToken && this.tokenExpiresAt) {
      const bufferTime = new Date(Date.now() + 5 * 60 * 1000);
      if (bufferTime < this.tokenExpiresAt) {
        return this.accessToken;
      }
    }

    const config = configManager.get();
    logger.debug('Refreshing Shopify access token');

    const response = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: config.shopify.clientId,
        client_secret: config.shopify.clientSecret,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to get access token: ${response.status}\nResponse: ${text}`);
    }

    const data = await response.json() as TokenResponse;
    this.accessToken = data.access_token;

    // Tokens expire in 86399 seconds (24 hours)
    const expiresIn = data.expires_in || 86399;
    this.tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

    logger.debug(`Token acquired, expires at ${this.tokenExpiresAt.toISOString()}`);
    return this.accessToken;
  }

  /**
   * Get headers for API requests
   */
  private async getHeaders(): Promise<Record<string, string>> {
    return {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': await this.getAccessToken(),
    };
  }

  /**
   * Execute a GraphQL query against the Admin API
   */
  async graphql<T = unknown>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<T> {
    const payload: { query: string; variables?: Record<string, unknown> } = { query };
    if (variables) {
      payload.variables = variables;
    }

    const response = await fetch(this.graphqlUrl, {
      method: 'POST',
      headers: await this.getHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GraphQL request failed: ${response.status}\nResponse: ${text}`);
    }

    const result = await response.json() as GraphQLResponse<T>;

    if (result.errors && result.errors.length > 0) {
      const errorMessages = result.errors.map(e => e.message).join(', ');
      throw new Error(`GraphQL errors: ${errorMessages}`);
    }

    return result.data as T;
  }

  /**
   * Execute a paginated query, fetching all pages
   */
  async graphqlPaginated<T, NodeType>(
    query: string,
    variables: Record<string, unknown>,
    getConnection: (data: T) => Connection<NodeType>
  ): Promise<NodeType[]> {
    const allNodes: NodeType[] = [];
    let cursor: string | undefined;
    let hasNextPage = true;

    while (hasNextPage) {
      const data = await this.graphql<T>(query, {
        ...variables,
        after: cursor,
      });

      const connection = getConnection(data);
      
      for (const edge of connection.edges) {
        allNodes.push(edge.node);
      }

      hasNextPage = connection.pageInfo.hasNextPage;
      cursor = connection.pageInfo.endCursor;
    }

    return allNodes;
  }

  /**
   * Check for user errors in a mutation response
   */
  checkUserErrors(userErrors: UserError[], operation: string): void {
    if (userErrors && userErrors.length > 0) {
      const messages = userErrors.map(e => `${e.field.join('.')}: ${e.message}`).join('; ');
      throw new Error(`${operation} failed: ${messages}`);
    }
  }

  /**
   * Get basic shop information
   */
  async getShopInfo(): Promise<{
    name: string;
    email: string;
    primaryDomain: { url: string };
    plan: { displayName: string };
  }> {
    const query = `
      query {
        shop {
          name
          email
          primaryDomain { url }
          plan { displayName }
        }
      }
    `;
    const data = await this.graphql<{ shop: { name: string; email: string; primaryDomain: { url: string }; plan: { displayName: string } } }>(query);
    return data.shop;
  }

  /**
   * Get all locations
   */
  async getLocations(): Promise<Array<{ id: string; name: string; isActive: boolean }>> {
    const query = `
      query {
        locations(first: 50) {
          edges {
            node {
              id
              name
              isActive
            }
          }
        }
      }
    `;
    const data = await this.graphql<{
      locations: { edges: Array<{ node: { id: string; name: string; isActive: boolean } }> };
    }>(query);
    
    return data.locations.edges.map(edge => edge.node);
  }

  /**
   * Get primary location ID
   */
  async getPrimaryLocationId(): Promise<string> {
    const locations = await this.getLocations();
    const primary = locations.find(l => l.isActive);
    if (!primary) {
      throw new Error('No active location found');
    }
    return primary.id;
  }

  /**
   * Set a metafield on any resource
   */
  async setMetafield(
    ownerId: string,
    namespace: string,
    key: string,
    value: string,
    type: string = 'single_line_text_field'
  ): Promise<{ id: string; namespace: string; key: string; value: string }> {
    const mutation = `
      mutation SetMetafield($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
            namespace
            key
            value
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const data = await this.graphql<{
      metafieldsSet: {
        metafields: Array<{ id: string; namespace: string; key: string; value: string }> | null;
        userErrors: UserError[];
      };
    }>(mutation, {
      metafields: [{ ownerId, namespace, key, value, type }],
    });

    this.checkUserErrors(data.metafieldsSet.userErrors, 'setMetafield');
    return data.metafieldsSet.metafields![0];
  }

  /**
   * Get markets
   */
  async getMarkets(): Promise<Array<{ id: string; name: string; handle: string; enabled: boolean }>> {
    const query = `
      query {
        markets(first: 50) {
          edges {
            node {
              id
              name
              handle
              enabled
            }
          }
        }
      }
    `;
    const data = await this.graphql<{
      markets: { edges: Array<{ node: { id: string; name: string; handle: string; enabled: boolean } }> };
    }>(query);
    
    return data.markets.edges.map(edge => edge.node);
  }
}

// Export singleton instance
export const shopifyClient = new ShopifyClient();
