import initSqlJs, { Database } from 'sql.js';
import fs from 'fs/promises';
import type {
  Task,
  SequentialState,
  Workflow,
  WorkflowRun
} from '../types.js';
import type { IStorageAdapter } from './IStorageAdapter.js';
import { StorageError } from '../errors.js';

/**
 * SQLite-based storage adapter using sql.js (pure JavaScript)
 * Stores data in a SQLite database file
 */
export class SqliteStorageAdapter implements IStorageAdapter {
  private db: Database | null = null;
  private storagePath: string;
  private sqlJs: any;

  constructor(storagePath: string) {
    this.storagePath = storagePath;
  }

  /**
   * Initialize the SQLite storage adapter
   * Loads sql.js and creates tables if they don't exist
   */
  async initialize(): Promise<void> {
    try {
      this.sqlJs = await initSqlJs();
      
      // Try to load existing database file
      try {
        const fileBuffer = await fs.readFile(this.storagePath);
        this.db = new this.sqlJs.Database(fileBuffer);
      } catch (err) {
        // File doesn't exist, create new database
        this.db = new this.sqlJs.Database();
        if (!this.db) throw new Error('Failed to create database');
      }

      // Create tables
      this.db!.run(`
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL,
          dependencies TEXT,
          soft_dependencies TEXT,
          dependency_timeouts TEXT,
          external_dependencies TEXT,
          conditional_dependencies TEXT,
          parent_task_id TEXT,
          session_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          started_at TEXT,
          completed_at TEXT,
          retries INTEGER DEFAULT 0,
          max_retries INTEGER,
          timeout_ms INTEGER,
          result TEXT,
          error TEXT,
          metadata TEXT
        );

        CREATE TABLE IF NOT EXISTS workflows (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          task_ids TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS workflow_runs (
          id TEXT PRIMARY KEY,
          workflow_id TEXT NOT NULL,
          status TEXT NOT NULL,
          completed_task_ids TEXT,
          active_task_ids TEXT,
          blocked_task_ids TEXT,
          started_at TEXT,
          completed_at TEXT,
          error TEXT,
          continue_on_failure INTEGER DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);
        CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_id ON workflow_runs(workflow_id);
      `);
    } catch (err) {
      throw new StorageError('Failed to initialize SQLite storage', err instanceof Error ? err : undefined);
    }
  }

  /**
   * Load state from SQLite database
   * @returns The loaded state
   */
  async load(): Promise<SequentialState> {
    if (!this.db) {
      throw new StorageError('Database not initialized');
    }

    try {
      // Load tasks
      const tasks = new Map<string, Task>();
      const taskRows = this.db!.exec('SELECT * FROM tasks')[0]?.values || [];
      
      for (const row of taskRows) {
        const task: Task = {
          id: row[0] as string,
          name: row[1] as string,
          description: row[2] as string || undefined,
          status: row[3] as Task['status'],
          dependencies: row[4] ? JSON.parse(row[4] as string) : [],
          softDependencies: row[5] ? JSON.parse(row[5] as string) : undefined,
          dependencyTimeouts: row[6] ? JSON.parse(row[6] as string) : undefined,
          externalDependencies: row[7] ? JSON.parse(row[7] as string) : undefined,
          conditionalDependencies: row[8] ? JSON.parse(row[8] as string) : undefined,
          parentTaskId: row[9] as string || undefined,
          sessionId: row[10] as string || undefined,
          createdAt: row[11] as string,
          updatedAt: row[12] as string,
          startedAt: row[13] as string || undefined,
          completedAt: row[14] as string || undefined,
          retries: row[15] as number || 0,
          maxRetries: row[16] as number || undefined,
          timeoutMs: row[17] as number || undefined,
          result: row[18] ? JSON.parse(row[18] as string) : undefined,
          error: row[19] as string || undefined,
          metadata: row[20] ? JSON.parse(row[20] as string) : undefined
        };
        tasks.set(task.id, task);
      }

      // Load workflows
      const workflows = new Map<string, Workflow>();
      const workflowRows = this.db!.exec('SELECT * FROM workflows')[0]?.values || [];
      
      for (const row of workflowRows) {
        const workflow: Workflow = {
          id: row[0] as string,
          name: row[1] as string,
          taskIds: JSON.parse(row[2] as string),
          createdAt: row[3] as string,
          updatedAt: row[4] as string
        };
        workflows.set(workflow.id, workflow);
      }

      // Load workflow runs
      const workflowRuns = new Map<string, WorkflowRun>();
      const runRows = this.db!.exec('SELECT * FROM workflow_runs')[0]?.values || [];
      
      for (const row of runRows) {
        const run: WorkflowRun = {
          id: row[0] as string,
          workflowId: row[1] as string,
          status: row[2] as WorkflowRun['status'],
          completedTaskIds: row[3] ? JSON.parse(row[3] as string) : [],
          activeTaskIds: row[4] ? JSON.parse(row[4] as string) : [],
          blockedTaskIds: row[5] ? JSON.parse(row[5] as string) : [],
          startedAt: row[6] as string || undefined,
          completedAt: row[7] as string || undefined,
          error: row[8] as string || undefined,
          continueOnFailure: (row[9] as number) === 1
        };
        workflowRuns.set(run.id, run);
      }

      return { tasks, workflows, workflowRuns };
    } catch (err) {
      throw new StorageError('Failed to load state from SQLite', err instanceof Error ? err : undefined);
    }
  }

  /**
   * Save state to SQLite database
   * @param state - The state to save
   */
  async save(state: SequentialState): Promise<void> {
    if (!this.db) {
      throw new StorageError('Database not initialized');
    }

    try {
      // Start transaction
      this.db!.run('BEGIN TRANSACTION');

      // Clear existing data
      this.db!.run('DELETE FROM tasks');
      this.db!.run('DELETE FROM workflows');
      this.db!.run('DELETE FROM workflow_runs');

      // Insert tasks
      for (const task of state.tasks.values()) {
        this.db!.run(`
          INSERT INTO tasks (
            id, name, description, status, dependencies, soft_dependencies,
            dependency_timeouts, external_dependencies, conditional_dependencies,
            parent_task_id, session_id, created_at, updated_at, started_at,
            completed_at, retries, max_retries, timeout_ms, result, error, metadata
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          task.id,
          task.name,
          task.description || null,
          task.status,
          JSON.stringify(task.dependencies),
          task.softDependencies ? JSON.stringify(task.softDependencies) : null,
          task.dependencyTimeouts ? JSON.stringify(task.dependencyTimeouts) : null,
          task.externalDependencies ? JSON.stringify(task.externalDependencies) : null,
          task.conditionalDependencies ? JSON.stringify(task.conditionalDependencies) : null,
          task.parentTaskId || null,
          task.sessionId || null,
          task.createdAt,
          task.updatedAt,
          task.startedAt || null,
          task.completedAt || null,
          task.retries || 0,
          task.maxRetries || null,
          task.timeoutMs || null,
          task.result ? JSON.stringify(task.result) : null,
          task.error || null,
          task.metadata ? JSON.stringify(task.metadata) : null
        ]);
      }

      // Insert workflows
      for (const workflow of state.workflows.values()) {
        this.db!.run(`
          INSERT INTO workflows (id, name, task_ids, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `, [
          workflow.id,
          workflow.name,
          JSON.stringify(workflow.taskIds),
          workflow.createdAt,
          workflow.updatedAt
        ]);
      }

      // Insert workflow runs
      for (const run of state.workflowRuns.values()) {
        this.db!.run(`
          INSERT INTO workflow_runs (
            id, workflow_id, status, completed_task_ids, active_task_ids,
            blocked_task_ids, started_at, completed_at, error, continue_on_failure
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          run.id,
          run.workflowId,
          run.status,
          JSON.stringify(run.completedTaskIds),
          JSON.stringify(run.activeTaskIds),
          JSON.stringify(run.blockedTaskIds),
          run.startedAt || null,
          run.completedAt || null,
          run.error || null,
          run.continueOnFailure ? 1 : 0
        ]);
      }

      this.db!.run('COMMIT');

      // Save database to file
      const data = this.db!.export();
      const buffer = Buffer.from(data);
      await fs.writeFile(this.storagePath, buffer);
    } catch (err) {
      this.db!.run('ROLLBACK');
      throw new StorageError('Failed to save state to SQLite', err instanceof Error ? err : undefined);
    }
  }

  /**
   * Close the SQLite database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Clear all data from storage
   */
  async clear(): Promise<void> {
    if (!this.db) {
      throw new StorageError('Database not initialized');
    }

    try {
      this.db.run('DELETE FROM tasks');
      this.db.run('DELETE FROM workflows');
      this.db.run('DELETE FROM workflow_runs');
      
      // Save the cleared database
      const data = this.db.export();
      const buffer = Buffer.from(data);
      await fs.writeFile(this.storagePath, buffer);
    } catch (err) {
      throw new StorageError('Failed to clear SQLite storage', err instanceof Error ? err : undefined);
    }
  }
}
