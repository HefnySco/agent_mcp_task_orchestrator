import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { ConfigurationError } from './errors.js';
import { FILE_CONFIG } from './constants.js';
import type { SequentialConfig } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Safe default storage directory in user's home directory
const DEFAULT_STORAGE_DIR = path.join(os.homedir(), '.task-orchestrator');

/**
 * Configuration manager for Task Orchestrator MCP server
 */
export class ConfigManager {
  private config: SequentialConfig;

  constructor() {
    this.config = this.loadConfig();
  }

  /**
   * Load configuration from environment variables with defaults
   */
  private loadConfig(): SequentialConfig {
    const storageBackend = (process.env.TASK_ORCHESTRATOR_STORAGE_BACKEND || 'json') as 'json' | 'sqlite';

    // Use safe default storage directory in user's home directory
    const storagePath = path.join(
      DEFAULT_STORAGE_DIR,
      'storage',
      storageBackend === 'sqlite'
        ? 'task-orchestrator-storage.db'
        : FILE_CONFIG.DEFAULT_STORAGE_FILENAME
    );

    const outputDir = process.env.TASK_ORCHESTRATOR_OUTPUT_DIR ||
      path.join(DEFAULT_STORAGE_DIR, FILE_CONFIG.DEFAULT_OUTPUT_DIR);
    
    const autoSave = process.env.TASK_ORCHESTRATOR_AUTO_SAVE !== 'false';
    
    const saveDebounceMs = parseInt(process.env.TASK_ORCHESTRATOR_SAVE_DEBOUNCE_MS || '1000', 10);

    // Validate configuration
    if (storageBackend !== 'json' && storageBackend !== 'sqlite') {
      throw new ConfigurationError('TASK_ORCHESTRATOR_STORAGE_BACKEND must be either "json" or "sqlite"');
    }

    if (isNaN(saveDebounceMs) || saveDebounceMs < 0) {
      throw new ConfigurationError('TASK_ORCHESTRATOR_SAVE_DEBOUNCE_MS must be a positive number');
    }

    return {
      storagePath,
      storageBackend,
      outputDir,
      autoSave,
      saveDebounceMs
    };
  }

  /**
   * Get the current configuration
   */
  getConfig(): SequentialConfig {
    return { ...this.config };
  }

  /**
   * Get storage path
   */
  getStoragePath(): string {
    return this.config.storagePath;
  }

  /**
   * Get storage backend
   */
  getStorageBackend(): 'json' | 'sqlite' {
    return this.config.storageBackend;
  }

  /**
   * Get output directory
   */
  getOutputDir(): string {
    return this.config.outputDir;
  }

  /**
   * Check if auto-save is enabled
   */
  isAutoSaveEnabled(): boolean {
    return this.config.autoSave;
  }

  /**
   * Get save debounce milliseconds
   */
  getSaveDebounceMs(): number {
    return this.config.saveDebounceMs;
  }

  /**
   * Update configuration (for testing purposes)
   */
  updateConfig(updates: Partial<SequentialConfig>): void {
    this.config = { ...this.config, ...updates };
  }
}

// Singleton instance
let configManagerInstance: ConfigManager | null = null;

/**
 * Get the singleton configuration manager instance
 */
export function getConfigManager(): ConfigManager {
  if (!configManagerInstance) {
    configManagerInstance = new ConfigManager();
  }
  return configManagerInstance;
}

/**
 * Reset the configuration manager (for testing purposes)
 */
export function resetConfigManager(): void {
  configManagerInstance = null;
}
