/**
 * Configuration Loader
 * Loads and validates configuration from YAML files and environment variables
 */

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { defaultConfig, defaultDataObjects } from './defaults';
import type {
  SwitchboardConfig,
  DataObjectsConfig,
  DataObjectConfig,
  RunMode,
  DataObjectName,
  DATA_OBJECT_NAMES,
} from './schema';

export * from './schema';
export { defaultConfig, defaultDataObjects };

/**
 * Deep merge two objects, with source taking precedence
 */
function deepMerge<T>(target: T, source: Partial<T>): T {
  if (!source) return target;
  
  const result = { ...target } as T;

  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceValue = source[key];
    const targetValue = target[key];

    if (
      sourceValue !== undefined &&
      typeof sourceValue === 'object' &&
      sourceValue !== null &&
      !Array.isArray(sourceValue) &&
      typeof targetValue === 'object' &&
      targetValue !== null &&
      !Array.isArray(targetValue)
    ) {
      (result as Record<string, unknown>)[key as string] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      );
    } else if (sourceValue !== undefined) {
      (result as Record<string, unknown>)[key as string] = sourceValue;
    }
  }

  return result;
}

/**
 * Load a YAML config file if it exists
 */
function loadYamlFile(filePath: string): Record<string, unknown> | null {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      return YAML.parse(content) || {};
    }
  } catch (error) {
    console.warn(`Warning: Failed to load config file ${filePath}:`, error);
  }
  return null;
}

/**
 * Get environment variable with optional default
 */
function getEnv(key: string, defaultValue?: string): string | undefined {
  return process.env[key] || defaultValue;
}

/**
 * Validate required configuration values
 */
function validateConfig(config: SwitchboardConfig): void {
  const errors: string[] = [];

  // Validate Shopify config
  if (!config.shopify.storeDomain) {
    errors.push('Missing SHOPIFY_STORE_DOMAIN');
  }
  if (!config.shopify.clientId) {
    errors.push('Missing SHOPIFY_CLIENT_ID');
  }
  if (!config.shopify.clientSecret) {
    errors.push('Missing SHOPIFY_CLIENT_SECRET');
  }

  // Validate Google Sheets config
  if (!config.googleSheets.spreadsheetId) {
    errors.push('Missing GOOGLE_SHEETS_SPREADSHEET_ID');
  }

  // Validate data objects
  for (const [name, objConfig] of Object.entries(config.dataObjects)) {
    if (objConfig.enabled) {
      if (objConfig.trigger === 'cron' && !objConfig.schedule) {
        errors.push(`Data object '${name}' has cron trigger but no schedule`);
      }
      if (objConfig.trigger === 'webhook' && (!objConfig.webhookTopics || objConfig.webhookTopics.length === 0)) {
        errors.push(`Data object '${name}' has webhook trigger but no webhookTopics`);
      }
      if (!objConfig.sheetName) {
        errors.push(`Data object '${name}' is missing sheetName`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n  - ${errors.join('\n  - ')}`);
  }
}

/**
 * Configuration manager singleton
 */
class ConfigManager {
  private config: SwitchboardConfig | null = null;
  private configDir: string;

  constructor() {
    this.configDir = path.resolve(process.cwd(), 'config');
  }

  /**
   * Load configuration from files and environment
   */
  load(modeOverride?: RunMode): SwitchboardConfig {
    // Start with defaults
    let config = JSON.parse(JSON.stringify(defaultConfig)) as SwitchboardConfig;

    // Load main config file
    const mainConfigPath = path.join(this.configDir, 'switchboard.yaml');
    const mainConfig = loadYamlFile(mainConfigPath);
    if (mainConfig) {
      config = deepMerge(config, mainConfig as unknown as Partial<SwitchboardConfig>);
    }

    // Determine mode (CLI override > env > config file > default)
    const mode: RunMode = modeOverride || 
      (getEnv('MODE') as RunMode) || 
      config.mode || 
      'demo';
    config.mode = mode;

    // Load mode-specific config
    const modeConfigPath = path.join(this.configDir, `${mode}.yaml`);
    const modeConfig = loadYamlFile(modeConfigPath);
    if (modeConfig) {
      config = deepMerge(config, modeConfig as unknown as Partial<SwitchboardConfig>);
    }

    // Override with environment variables
    config.shopify = {
      storeDomain: getEnv('SHOPIFY_STORE_DOMAIN', config.shopify.storeDomain) || '',
      clientId: getEnv('SHOPIFY_CLIENT_ID', config.shopify.clientId) || '',
      clientSecret: getEnv('SHOPIFY_CLIENT_SECRET', config.shopify.clientSecret) || '',
      apiVersion: getEnv('SHOPIFY_API_VERSION', config.shopify.apiVersion) || '2026-01',
    };

    config.googleSheets = {
      spreadsheetId: getEnv('GOOGLE_SHEETS_SPREADSHEET_ID', config.googleSheets.spreadsheetId) || '',
    };

    config.webhookPort = parseInt(getEnv('WEBHOOK_PORT', String(config.webhookPort)) || '3000', 10);

    // Validate configuration
    validateConfig(config);

    this.config = config;
    return config;
  }

  /**
   * Get the current configuration
   */
  get(): SwitchboardConfig {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call load() first.');
    }
    return this.config;
  }

  /**
   * Get configuration for a specific data object
   */
  getDataObject(name: DataObjectName): DataObjectConfig {
    const config = this.get();
    return config.dataObjects[name];
  }

  /**
   * Get the active schedule for a data object based on current mode
   */
  getActiveSchedule(name: DataObjectName): string | undefined {
    const config = this.get();
    const objConfig = config.dataObjects[name];
    
    if (objConfig.trigger !== 'cron' || !objConfig.schedule) {
      return undefined;
    }

    return config.mode === 'demo' 
      ? objConfig.schedule.demo 
      : objConfig.schedule.production;
  }

  /**
   * Get all enabled data objects sorted by dependencies
   */
  getEnabledDataObjects(): DataObjectName[] {
    const config = this.get();
    const enabled: DataObjectName[] = [];
    
    for (const name of Object.keys(config.dataObjects) as DataObjectName[]) {
      if (config.dataObjects[name].enabled) {
        enabled.push(name);
      }
    }

    // Sort by dependencies (topological sort)
    return this.sortByDependencies(enabled);
  }

  /**
   * Sort data objects by dependencies using topological sort
   */
  private sortByDependencies(objects: DataObjectName[]): DataObjectName[] {
    const config = this.get();
    const sorted: DataObjectName[] = [];
    const visited = new Set<DataObjectName>();
    const visiting = new Set<DataObjectName>();

    const visit = (name: DataObjectName): void => {
      if (visited.has(name)) return;
      if (visiting.has(name)) {
        throw new Error(`Circular dependency detected involving '${name}'`);
      }

      visiting.add(name);

      const deps = config.dataObjects[name].dependencies || [];
      for (const dep of deps as DataObjectName[]) {
        if (objects.includes(dep)) {
          visit(dep);
        }
      }

      visiting.delete(name);
      visited.add(name);
      sorted.push(name);
    };

    for (const name of objects) {
      visit(name);
    }

    return sorted;
  }

  /**
   * Check if running in demo mode
   */
  isDemo(): boolean {
    return this.get().mode === 'demo';
  }

  /**
   * Get the webhook secret for HMAC verification
   */
  getWebhookSecret(): string {
    return getEnv('WEBHOOK_SECRET') || '';
  }
}

// Export singleton instance
export const configManager = new ConfigManager();
