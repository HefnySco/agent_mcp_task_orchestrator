import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type {
  Task,
  SequentialState,
  CreateTaskInput,
  UpdateTaskInput,
  TaskExecutionResult,
  TaskStats,
  WorkflowRun,
  Workflow
} from './types.js';
import {
  StorageError,
  TaskNotFoundError,
  DependencyNotFoundError
} from './errors.js';
import { TASK_STATUS } from './constants.js';
import { getConfigManager } from './config.js';
/**
 * SequentialService manages task execution with dependency tracking
 */
export class SequentialService {
  private storagePath: string;
  private state: SequentialState;
  private saveTimeout: NodeJS.Timeout | null = null;
  private autoSave: boolean;
  private saveDebounceMs: number;

  /**
   * Create a new SequentialService instance
   * @param storagePath - Path to the storage file
   */
  constructor(storagePath: string) {
    this.storagePath = storagePath;
    this.state = {
      tasks: new Map(),
      workflows: new Map(),
      workflowRuns: new Map()
    };
    
    const config = getConfigManager();
    this.autoSave = config.isAutoSaveEnabled();
    this.saveDebounceMs = config.getSaveDebounceMs();
  }

  /**
   * Load state from storage file
   * @throws StorageError if file cannot be read or parsed
   */
  async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.storagePath, 'utf-8');
      const parsed = JSON.parse(data);
      
      this.state.tasks = new Map(
        Object.entries(parsed.tasks || {}).map(([id, task]: [string, unknown]) => [id, task as Task])
      );
      
      this.state.workflows = new Map(
        Object.entries(parsed.workflows || {}).map(([id, workflow]: [string, unknown]) => {
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
      
      this.state.workflowRuns = new Map(
        Object.entries(parsed.workflowRuns || {}).map(([id, run]: [string, unknown]) => [id, run as WorkflowRun])
      );
    } catch (err) {
      // File doesn't exist or is empty, start with empty state
      this.state = {
        tasks: new Map(),
        workflows: new Map(),
        workflowRuns: new Map()
      };
    }
  }

  /**
   * Save state to storage file
   * @throws StorageError if file cannot be written
   */
  async save(): Promise<void> {
    try {
      const data = {
        tasks: Object.fromEntries(this.state.tasks),
        workflows: Object.fromEntries(this.state.workflows),
        workflowRuns: Object.fromEntries(this.state.workflowRuns)
      };
      
      const dir = path.dirname(this.storagePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.storagePath, JSON.stringify(data, null, 2));
    } catch (err) {
      throw new StorageError('Failed to save state', err instanceof Error ? err : undefined);
    }
  }

  /**
   * Trigger debounced save if auto-save is enabled
   */
  private triggerSave(): void {
    if (!this.autoSave) {
      return;
    }

    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = setTimeout(async () => {
      try {
        await this.save();
      } catch (err) {
        console.error('Auto-save failed:', err);
      }
    }, this.saveDebounceMs);
  }

  /**
   * Force immediate save (bypasses debouncing)
   */
  async forceSave(): Promise<void> {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    await this.save();
  }

  /**
   * Create a new task
   * @param task - Task creation input
   * @returns The created task
   * @throws DependencyNotFoundError if a dependency task doesn't exist
   * @throws Error if circular dependency is detected
   */
  createTask(task: CreateTaskInput): Task {
    const id = this.generateId();
    const now = new Date().toISOString();
    
    // Validate dependencies exist
    if (task.dependencies) {
      for (const depId of task.dependencies) {
        if (!this.state.tasks.has(depId)) {
          throw new DependencyNotFoundError(depId);
        }
      }
    }
    
    // Validate parent task exists
    if (task.parentTaskId && !this.state.tasks.has(task.parentTaskId)) {
      throw new TaskNotFoundError(task.parentTaskId);
    }
    
    // Check for circular dependencies
    if (task.dependencies && task.dependencies.length > 0) {
      this.checkCircularDependency(id, task.dependencies);
    }
    
    const newTask: Task = {
      id,
      name: task.name,
      description: task.description,
      dependencies: task.dependencies || [],
      parentTaskId: task.parentTaskId,
      metadata: task.metadata,
      maxRetries: task.maxRetries,
      timeoutMs: task.timeoutMs,
      retries: 0,
      status: TASK_STATUS.PENDING,
      createdAt: now,
      updatedAt: now
    };
    
    this.state.tasks.set(id, newTask);
    this.triggerSave();
    return newTask;
  }

  /**
   * Create multiple tasks in batch
   * @param tasks - Array of task creation inputs
   * @returns Array of created tasks
   * @throws DependencyNotFoundError if a dependency task doesn't exist
   * @throws Error if circular dependency is detected
   */
  createTasks(tasks: CreateTaskInput[]): Task[] {
    const createdTasks: Task[] = [];
    
    for (const task of tasks) {
      const createdTask = this.createTask(task);
      createdTasks.push(createdTask);
    }
    
    return createdTasks;
  }

  /**
   * Check for circular dependencies in task graph
   * @param taskId - The new task ID being created
   * @param dependencies - Dependencies of the new task
   * @throws Error if circular dependency is detected
   */
  private checkCircularDependency(taskId: string, dependencies: string[]): void {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const now = new Date().toISOString();

    const hasCycle = (currentId: string): boolean => {
      visited.add(currentId);
      recursionStack.add(currentId);

      const task = this.state.tasks.get(currentId);
      if (task) {
        for (const depId of task.dependencies) {
          if (!visited.has(depId)) {
            if (hasCycle(depId)) {
              return true;
            }
          } else if (recursionStack.has(depId)) {
            return true;
          }
        }
      }

      recursionStack.delete(currentId);
      return false;
    };

    // Check if any dependency would create a cycle back to the new task
    for (const depId of dependencies) {
      visited.clear();
      recursionStack.clear();
      
      // Temporarily add the new task to check for cycles
      this.state.tasks.set(taskId, {
        id: taskId,
        name: 'temp',
        status: TASK_STATUS.PENDING,
        dependencies: [],
        createdAt: now,
        updatedAt: now
      } as Task);
      
      const hasCycleFromDep = hasCycle(depId);
      
      // Remove the temporary task
      this.state.tasks.delete(taskId);
      
      if (hasCycleFromDep) {
        throw new Error(`Circular dependency detected: task ${taskId} depends on ${depId}, which would create a cycle`);
      }
    }
  }

  /**
   * Update an existing task
   * @param id - Task ID
   * @param updates - Partial task updates
   * @returns The updated task or null if not found
   */
  updateTask(id: string, updates: UpdateTaskInput): Task | null {
    const task = this.state.tasks.get(id);
    if (!task) return null;
    
    const updatedTask: Task = {
      ...task,
      ...updates,
      id,
      updatedAt: new Date().toISOString()
    };
    
    this.state.tasks.set(id, updatedTask);
    this.triggerSave();
    return updatedTask;
  }

  /**
   * Delete a task
   * @param id - Task ID
   * @returns True if task was deleted, false if not found
   */
  deleteTask(id: string): boolean {
    const deleted = this.state.tasks.delete(id);
    if (deleted) {
      this.triggerSave();
    }
    return deleted;
  }

  /**
   * Get a task by ID
   * @param id - Task ID
   * @returns The task or undefined if not found
   */
  getTask(id: string): Task | undefined {
    return this.state.tasks.get(id);
  }

  /**
   * Get all tasks
   * @returns Array of all tasks
   */
  getAllTasks(): Task[] {
    return Array.from(this.state.tasks.values());
  }

  /**
   * Get tasks by status
   * @param status - Task status to filter by
   * @returns Array of tasks with the specified status
   */
  getTasksByStatus(status: Task['status']): Task[] {
    return this.getAllTasks().filter(task => task.status === status);
  }

  /**
   * Create a workflow
   * @param name - Workflow name
   * @param taskIds - Array of task IDs in the workflow
   * @returns The created workflow
   */
  createWorkflow(name: string, taskIds: string[]): Workflow {
    const workflowId = this.generateId();
    const now = new Date().toISOString();
    
    const workflow: Workflow = {
      id: workflowId,
      name,
      taskIds,
      createdAt: now,
      updatedAt: now
    };
    
    this.state.workflows.set(workflowId, workflow);
    this.triggerSave();
    return workflow;
  }

  /**
   * Get a workflow by ID
   * @param id - Workflow ID
   * @returns Workflow or undefined if not found
   */
  getWorkflow(id: string): Workflow | undefined {
    return this.state.workflows.get(id);
  }

  /**
   * Get all workflows
   * @returns Object mapping workflow IDs to workflow objects
   */
  getAllWorkflows(): Record<string, Workflow> {
    return Object.fromEntries(this.state.workflows);
  }

  /**
   * Delete a workflow
   * @param id - Workflow ID
   * @returns True if workflow was deleted, false if not found
   */
  deleteWorkflow(id: string): boolean {
    const deleted = this.state.workflows.delete(id);
    if (deleted) {
      this.triggerSave();
    }
    return deleted;
  }

  /**
   * Check if a task can be executed based on its dependencies
   * @param taskId - Task ID to check
   * @returns Execution check result with reason if not executable
   */
  canExecuteTask(taskId: string): TaskExecutionResult {
    const task = this.state.tasks.get(taskId);
    if (!task) {
      return { canExecute: false, reason: 'Task not found' };
    }

    if (task.status !== TASK_STATUS.PENDING) {
      return { canExecute: false, reason: `Task is ${task.status}` };
    }

    // Check if all dependencies are completed
    for (const depId of task.dependencies) {
      const depTask = this.state.tasks.get(depId);
      if (!depTask) {
        return { canExecute: false, reason: `Dependency ${depId} not found` };
      }
      if (depTask.status !== TASK_STATUS.COMPLETED) {
        return { canExecute: false, reason: `Dependency ${depId} is ${depTask.status}` };
      }
    }

    return { canExecute: true };
  }

  /**
   * Get tasks that are ready to execute (all dependencies completed)
   * @returns Array of executable tasks
   */
  getNextExecutableTasks(): Task[] {
    const pendingTasks = this.getTasksByStatus(TASK_STATUS.PENDING);
    return pendingTasks.filter(task => this.canExecuteTask(task.id).canExecute);
  }

  /**
   * Execute a task (mark as completed with result)
   * @param taskId - Task ID to execute
   * @param result - Optional execution result
   * @returns The executed task or null if cannot be executed
   */
  executeTask(taskId: string, result?: unknown): Task | null {
    const canExecute = this.canExecuteTask(taskId);
    if (!canExecute.canExecute) {
      return null;
    }

    return this.updateTask(taskId, {
      status: TASK_STATUS.COMPLETED,
      result,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  /**
   * Mark a task as failed
   * @param taskId - Task ID to fail
   * @param error - Error message
   * @returns The failed task or null if not found
   */
  failTask(taskId: string, error: string): Task | null {
    const task = this.state.tasks.get(taskId);
    if (!task) return null;

    return this.updateTask(taskId, {
      status: TASK_STATUS.FAILED,
      error,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  /**
   * Mark a task as in progress
   * @param taskId - Task ID to mark
   * @returns The task or null if cannot be marked
   */
  markTaskInProgress(taskId: string): Task | null {
    const canExecute = this.canExecuteTask(taskId);
    if (!canExecute.canExecute) {
      return null;
    }

    return this.updateTask(taskId, {
      status: TASK_STATUS.IN_PROGRESS,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  /**
   * Reset a task back to pending status
   * @param taskId - Task ID to reset
   * @returns The reset task or null if not found
   */
  resetTask(taskId: string): Task | null {
    return this.updateTask(taskId, {
      status: TASK_STATUS.PENDING,
      result: undefined,
      error: undefined,
      startedAt: undefined,
      completedAt: undefined,
      updatedAt: new Date().toISOString()
    });
  }

  /**
   * Retry a failed task
   * @param taskId - Task ID to retry
   * @returns The retried task or null if cannot be retried
   */
  retryTask(taskId: string): Task | null {
    const task = this.state.tasks.get(taskId);
    if (!task) return null;

    // Check if task has exceeded max retries
    if (task.maxRetries !== undefined && task.retries !== undefined && task.retries >= task.maxRetries) {
      return null;
    }

    const newRetries = (task.retries || 0) + 1;

    return this.updateTask(taskId, {
      status: TASK_STATUS.PENDING,
      result: undefined,
      error: undefined,
      startedAt: undefined,
      completedAt: undefined,
      retries: newRetries,
      updatedAt: new Date().toISOString()
    });
  }

  /**
   * Clear all tasks and workflows
   */
  clearAll(): void {
    this.state.tasks.clear();
    this.state.workflows.clear();
    this.state.workflowRuns.clear();
    this.triggerSave();
  }

  /**
   * Get statistics about tasks and workflows
   * @returns Task and workflow statistics
   */
  getStats(): TaskStats {
    const tasks = this.getAllTasks();
    return {
      totalTasks: tasks.length,
      pending: tasks.filter(t => t.status === TASK_STATUS.PENDING).length,
      inProgress: tasks.filter(t => t.status === TASK_STATUS.IN_PROGRESS).length,
      completed: tasks.filter(t => t.status === TASK_STATUS.COMPLETED).length,
      failed: tasks.filter(t => t.status === TASK_STATUS.FAILED).length,
      totalWorkflows: this.state.workflows.size
    };
  }

  /**
   * Generate a unique ID using UUID
   * @returns Unique ID string
   */
  private generateId(): string {
    return uuidv4();
  }

  /**
   * Calculate task duration in milliseconds
   * @param task - Task to calculate duration for
   * @returns Duration in milliseconds or null if not available
   */
  private calculateTaskDuration(task: Task): number | null {
    if (!task.startedAt || !task.completedAt) {
      return null;
    }
    const started = new Date(task.startedAt).getTime();
    const completed = new Date(task.completedAt).getTime();
    return completed - started;
  }

  /**
   * Format duration in human-readable format
   * @param durationMs - Duration in milliseconds
   * @returns Human-readable duration string
   */
  private formatDuration(durationMs: number): string {
    if (durationMs < 1000) {
      return `${durationMs}ms`;
    } else if (durationMs < 60000) {
      return `${(durationMs / 1000).toFixed(1)}s`;
    } else if (durationMs < 3600000) {
      return `${(durationMs / 60000).toFixed(1)}m`;
    } else {
      return `${(durationMs / 3600000).toFixed(1)}h`;
    }
  }

  /**
   * Get task with duration information
   * @param taskId - Task ID
   * @returns Task with duration info or undefined
   */
  getTaskWithDuration(taskId: string): (Task & { duration?: number; durationFormatted?: string }) | undefined {
    const task = this.state.tasks.get(taskId);
    if (!task) return undefined;

    const duration = this.calculateTaskDuration(task);
    return {
      ...task,
      duration: duration || undefined,
      durationFormatted: duration ? this.formatDuration(duration) : undefined
    };
  }

  /**
   * Start workflow execution with dependency-aware task initialization
   * @param workflowId - Workflow ID to execute
   * @returns Object with runId and initially ready tasks, or null if workflow not found
   */
  startWorkflowExecution(workflowId: string): { runId: string; readyTasks: Task[] } | null {
    const workflow = this.state.workflows.get(workflowId);
    if (!workflow) return null;

    const runId = this.generateId();
    const now = new Date().toISOString();

    // Find all tasks in this workflow that can be executed initially
    const readyTasks: Task[] = [];
    const blockedTaskIds: string[] = [];

    for (const taskId of workflow.taskIds) {
      const task = this.state.tasks.get(taskId);
      if (!task) {
        blockedTaskIds.push(taskId);
        continue;
      }

      const canExecute = this.canExecuteTask(taskId);
      if (canExecute.canExecute) {
        readyTasks.push(task);
        // Mark as in progress
        this.markTaskInProgress(taskId);
      } else {
        blockedTaskIds.push(taskId);
      }
    }

    const workflowRun = {
      id: runId,
      workflowId,
      status: 'in_progress' as const,
      completedTaskIds: [],
      activeTaskIds: readyTasks.map(t => t.id),
      blockedTaskIds,
      startedAt: now
    };

    this.state.workflowRuns.set(runId, workflowRun);
    return { runId, readyTasks };
  }

  /**
   * Advance workflow run by finding newly unlocked tasks
   * @param runId - Workflow run ID
   * @returns Object with updated run and newly ready tasks, or null if not found
   */
  advanceWorkflowRun(runId: string): { run: WorkflowRun; newReadyTasks: Task[] } | null {
    const run = this.state.workflowRuns.get(runId);
    if (!run) return null;

    const workflow = this.state.workflows.get(run.workflowId);
    if (!workflow) return null;

    // Get current task states in the workflow
    const currentCompleted = new Set(run.completedTaskIds);
    const currentActive = new Set(run.activeTaskIds);

    // Check for newly completed tasks (tasks that were active but are now completed)
    const newlyCompleted: string[] = [];
    for (const activeTaskId of currentActive) {
      const task = this.state.tasks.get(activeTaskId);
      if (task && task.status === TASK_STATUS.COMPLETED) {
        newlyCompleted.push(activeTaskId);
      } else if (task && task.status === TASK_STATUS.FAILED) {
        // Task failed - check if it can be retried
        if (task.maxRetries !== undefined && task.retries !== undefined && task.retries < task.maxRetries) {
          // Can be retried, don't mark as failed for workflow
          continue;
        }
        // Task failed and cannot be retried - mark workflow as failed
        const updatedRun = {
          ...run,
          status: 'failed' as const,
          error: `Task ${activeTaskId} failed: ${task.error}`,
          completedAt: new Date().toISOString()
        };
        this.state.workflowRuns.set(runId, updatedRun);
        return { run: updatedRun, newReadyTasks: [] };
      } else if (task && task.status === TASK_STATUS.IN_PROGRESS && task.timeoutMs && task.startedAt) {
        // Check if task has exceeded its timeout
        const startedTime = new Date(task.startedAt).getTime();
        const currentTime = Date.now();
        const elapsed = currentTime - startedTime;
        
        if (elapsed > task.timeoutMs) {
          // Task has timed out - fail it
          this.failTask(activeTaskId, `Task timed out after ${elapsed}ms (timeout: ${task.timeoutMs}ms)`);
          newlyCompleted.push(activeTaskId);
        }
      }
    }

    // Update completed tasks
    const updatedCompleted = [...run.completedTaskIds, ...newlyCompleted];
    const updatedActive = run.activeTaskIds.filter(id => !newlyCompleted.includes(id));

    // Find newly unlocked tasks
    const newReadyTasks: Task[] = [];
    const newBlockedTaskIds: string[] = [];

    for (const taskId of workflow.taskIds) {
      // Skip if already completed or active
      if (updatedCompleted.includes(taskId) || updatedActive.includes(taskId)) {
        continue;
      }

      const task = this.state.tasks.get(taskId);
      if (!task) {
        newBlockedTaskIds.push(taskId);
        continue;
      }

      const canExecute = this.canExecuteTask(taskId);
      if (canExecute.canExecute) {
        newReadyTasks.push(task);
        // Mark as in progress
        this.markTaskInProgress(taskId);
      } else {
        newBlockedTaskIds.push(taskId);
      }
    }

    // Update workflow run state
    const updatedActiveTaskIds = [...updatedActive, ...newReadyTasks.map(t => t.id)];
    const updatedBlockedTaskIds = [...run.blockedTaskIds.filter(id => !newReadyTasks.map(t => t.id).includes(id)), ...newBlockedTaskIds];

    // Check if workflow is complete
    const allTasksCompleted = workflow.taskIds.every((taskId: string) => updatedCompleted.includes(taskId));
    const workflowStatus = allTasksCompleted ? 'completed' as const : 'in_progress' as const;

    const updatedRun = {
      ...run,
      status: workflowStatus,
      completedTaskIds: updatedCompleted,
      activeTaskIds: updatedActiveTaskIds,
      blockedTaskIds: updatedBlockedTaskIds,
      completedAt: allTasksCompleted ? new Date().toISOString() : undefined
    };

    this.state.workflowRuns.set(runId, updatedRun);
    return { run: updatedRun, newReadyTasks };
  }

  /**
   * Get a workflow run by ID
   * @param runId - Workflow run ID
   * @returns Workflow run or undefined
   */
  getWorkflowRun(runId: string): WorkflowRun | undefined {
    return this.state.workflowRuns.get(runId);
  }

  /**
   * Get all workflow runs
   * @returns Array of all workflow runs
   */
  getAllWorkflowRuns(): WorkflowRun[] {
    return Array.from(this.state.workflowRuns.values());
  }

  /**
   * Delete old workflow runs based on age or count
   * @param options - Cleanup options
   * @returns Number of deleted runs
   */
  cleanupWorkflowRuns(options: { maxAgeMs?: number; maxCount?: number }): number {
    const now = Date.now();
    let deletedCount = 0;

    for (const [runId, run] of this.state.workflowRuns) {
      let shouldDelete = false;

      // Check age-based cleanup
      if (options.maxAgeMs && run.startedAt) {
        const startedTime = new Date(run.startedAt).getTime();
        const age = now - startedTime;
        if (age > options.maxAgeMs) {
          shouldDelete = true;
        }
      }

      // Check count-based cleanup (keep only the most recent runs)
      if (options.maxCount && !shouldDelete) {
        const allRuns = Array.from(this.state.workflowRuns.values())
          .sort((a, b) => {
            const timeA = a.startedAt ? new Date(a.startedAt).getTime() : 0;
            const timeB = b.startedAt ? new Date(b.startedAt).getTime() : 0;
            return timeB - timeA; // Sort by newest first
          });
        
        const runIndex = allRuns.findIndex(r => r.id === run.id);
        if (runIndex >= options.maxCount) {
          shouldDelete = true;
        }
      }

      if (shouldDelete) {
        this.state.workflowRuns.delete(runId);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      this.triggerSave();
    }

    return deletedCount;
  }

  /**
   * Get all subtasks of a parent task
   * @param parentTaskId - The parent task ID
   * @returns Array of subtasks
   */
  getSubtasks(parentTaskId: string): Task[] {
    return Array.from(this.state.tasks.values()).filter(
      task => task.parentTaskId === parentTaskId
    );
  }

  /**
   * Get a task with its direct subtasks
   * @param taskId - The task ID
   * @returns Object containing the task and its subtasks
   * @throws TaskNotFoundError if task doesn't exist
   */
  getTaskWithSubtasks(taskId: string): { task: Task; subtasks: Task[] } {
    const task = this.getTask(taskId);
    if (!task) {
      throw new TaskNotFoundError(taskId);
    }
    const subtasks = this.getSubtasks(taskId);
    return { task, subtasks };
  }

  /**
   * Get next ready tasks for a specific workflow (dependency-aware)
   * @param workflowId - Workflow ID to get ready tasks for
   * @returns Array of ready tasks in the workflow
   */
  getNextWorkflowTasks(workflowId: string): Task[] {
    const workflow = this.state.workflows.get(workflowId);
    if (!workflow) return [];

    const readyTasks: Task[] = [];

    for (const taskId of workflow.taskIds) {
      const task = this.state.tasks.get(taskId);
      if (!task) continue;

      // Only include pending tasks that can be executed
      if (task.status === TASK_STATUS.PENDING && this.canExecuteTask(taskId).canExecute) {
        readyTasks.push(task);
      }
    }

    return readyTasks;
  }
}
