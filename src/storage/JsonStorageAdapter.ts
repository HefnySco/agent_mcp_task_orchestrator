import fs from 'fs/promises';
import path from 'path';
import type {
  Task,
  SequentialState,
  Workflow,
  WorkflowRun,
  Strategy
} from '../types.js';
import type { IStorageAdapter } from './IStorageAdapter.js';
import { StorageError } from '../errors.js';

/**
 * JSON file-based storage adapter
 * Stores data as JSON in a file
 */
export class JsonStorageAdapter implements IStorageAdapter {
  private storagePath: string;

  constructor(storagePath: string) {
    this.storagePath = storagePath;
  }

  /**
   * Initialize the JSON storage adapter
   * Ensures the directory exists
   */
  async initialize(): Promise<void> {
    const dir = path.dirname(this.storagePath);
    await fs.mkdir(dir, { recursive: true });
  }

  /**
   * Load state from JSON file
   * @returns The loaded state
   */
  async load(): Promise<SequentialState> {
    try {
      const data = await fs.readFile(this.storagePath, 'utf-8');
      const parsed = JSON.parse(data);
      
      const validStatuses = ['pending', 'in_progress', 'completed', 'failed'] as const;
      const tasks = new Map<string, Task>(
        Object.entries(parsed.tasks || {}).map(([id, task]: [string, unknown]) => {
          const taskObj = task as Task;
          const validatedStatus = validStatuses.includes(taskObj.status as any) ? taskObj.status : 'pending';
          return [id, { ...taskObj, status: validatedStatus as Task['status'] }];
        })
      );
      
      const workflows = new Map<string, Workflow>(
        Object.entries(parsed.workflows || {}).map(([id, workflow]: [string, unknown]) => {
          // TODO: Remove this legacy migration code once all deployments have run at least once with the new schema
          // Handle both old format (string[]) and new format (Workflow)
          if (Array.isArray(workflow)) {
            // Old format - migrate to new format
            return [id, {
              id,
              name: 'Migrated Workflow',
              taskIds: workflow as string[],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            } as Workflow];
          }
          return [id, workflow as Workflow];
        })
      );
      
      const workflowRuns = new Map<string, WorkflowRun>(
        Object.entries(parsed.workflowRuns || {}).map(([id, run]: [string, unknown]) => [id, run as WorkflowRun])
      );

      const strategies = new Map<string, Strategy>(
        Object.entries(parsed.strategies || {}).map(([id, strategy]: [string, unknown]) => [id, strategy as Strategy])
      );

      return { tasks, workflows, workflowRuns, strategies };
    } catch (err) {
      // Return empty state if file doesn't exist or JSON is corrupted
      if ((err as NodeJS.ErrnoException).code === 'ENOENT' || err instanceof SyntaxError) {
        console.warn(`[JsonStorageAdapter] Storage file ${this.storagePath} is missing or corrupted. Starting with empty state.`);
        return {
          tasks: new Map(),
          workflows: new Map(),
          workflowRuns: new Map(),
          strategies: new Map()
        };
      }
      // For any other error, fail fast
      throw new StorageError('Failed to load state from JSON file', err instanceof Error ? err : undefined);
    }
  }

  /**
   * Save state to JSON file
   * @param state - The state to save
   */
  async save(state: SequentialState): Promise<void> {
    try {
      const data = {
        tasks: Object.fromEntries(state.tasks),
        workflows: Object.fromEntries(state.workflows),
        workflowRuns: Object.fromEntries(state.workflowRuns),
        strategies: Object.fromEntries(state.strategies)
      };

      const dir = path.dirname(this.storagePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.storagePath, JSON.stringify(data, null, 2));
    } catch (err) {
      throw new StorageError('Failed to save state to JSON file', err instanceof Error ? err : undefined);
    }
  }

  /**
   * Close the JSON storage adapter
   * No-op for file-based storage
   */
  async close(): Promise<void> {
    // No-op for file-based storage
  }

  /**
   * Clear all data from storage
   */
  async clear(): Promise<void> {
    try {
      await fs.unlink(this.storagePath);
    } catch (err) {
      // File doesn't exist, that's fine
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new StorageError('Failed to clear JSON storage', err instanceof Error ? err : undefined);
      }
    }
  }
}
