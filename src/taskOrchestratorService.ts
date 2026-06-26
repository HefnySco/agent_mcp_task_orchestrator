import { v4 as uuidv4 } from 'uuid';
import type {
  Task,
  SequentialState,
  CreateTaskInput,
  UpdateTaskInput,
  TaskExecutionResult,
  TaskStats,
  WorkflowRun,
  Workflow,
  WorkflowRunStatus
} from './types.js';
import {
  StorageError,
  TaskNotFoundError,
  DependencyNotFoundError,
  ValidationError
} from './errors.js';
import { TASK_STATUS } from './constants.js';
import { getConfigManager } from './config.js';
import type { IStorageAdapter } from './storage/IStorageAdapter.js';
import { StorageFactory } from './storage/StorageFactory.js';
/**
 * TaskOrchestratorService manages task execution with dependency tracking
 */
export class TaskOrchestratorService {
  private storageAdapter: IStorageAdapter;
  private state: SequentialState;
  private saveTimeout: NodeJS.Timeout | null = null;
  private autoSave: boolean;
  private saveDebounceMs: number;

  /**
   * Create a new TaskOrchestratorService instance
   * @param storageAdapter - Storage adapter to use
   */
  constructor(storageAdapter: IStorageAdapter) {
    this.storageAdapter = storageAdapter;
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
   * Load state from storage
   * @throws StorageError if storage cannot be read
   */
  async load(): Promise<void> {
    try {
      this.state = await this.storageAdapter.load();
    } catch (err) {
      throw new StorageError('Failed to load state from storage', err instanceof Error ? err : undefined);
    }
  }

  /**
   * Save state to storage
   * @throws StorageError if storage cannot be written
   */
  async save(): Promise<void> {
    if (this.storageAdapter && 'db' in this.storageAdapter && !(this.storageAdapter as any).db) {
      console.warn('⚠️ Save skipped: DB not ready yet');
      return;
    }
    try {
      await this.storageAdapter.save(this.state);
    } catch (err) {
      throw new StorageError('Failed to save state to storage', err instanceof Error ? err : undefined);
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
   * Shutdown the service and clear any pending auto-save
   */
  async shutdown(): Promise<void> {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    // Do a final save to ensure data is persisted before shutdown
    try {
      await this.save();
    } catch {
      // Ignore save errors during shutdown (DB might already be closed)
    }
  }

  /**
   * Create a new task
   * @param task - Task creation input
   * @returns The created task
   * @throws DependencyNotFoundError if a dependency task doesn't exist
   * @throws Error if circular dependency is detected
   *
   * Note: Parent tasks now wait for their subtasks to complete before they can be marked
   * as completed. Subtasks can start independently of their parent's status.
   */
  createTask(task: CreateTaskInput): Task {
    const id = this.generateId();
    const now = new Date().toISOString();
    
    // Resolve and validate dependencies
    // Supports: existing task IDs, or task names (case-insensitive match against existing tasks)
    let resolvedDeps: string[] = [];
    if (task.dependencies && task.dependencies.length > 0) {
      for (const dep of task.dependencies) {
        if (this.state.tasks.has(dep)) {
          resolvedDeps.push(dep);
        } else {
          // Try matching by task name (case-insensitive)
          let nameMatch: Task | undefined;
          for (const existingTask of this.state.tasks.values()) {
            if (existingTask.name.toLowerCase() === dep.toLowerCase()) {
              nameMatch = existingTask;
              break;
            }
          }
          if (nameMatch) {
            resolvedDeps.push(nameMatch.id);
          } else {
            throw new DependencyNotFoundError(
              `Dependency '${dep}' could not be resolved. Use an existing task ID or task name.`
            );
          }
        }
      }
    }
    
    // Validate parent task exists
    if (task.parentTaskId && !this.state.tasks.has(task.parentTaskId)) {
      throw new TaskNotFoundError(task.parentTaskId);
    }
    
    // Dependencies are NOT auto-added from parentTaskId
    // Subtasks can start independently; parent waits for subtasks to complete
    let dependencies = resolvedDeps;
    
    // Check for circular dependencies
    if (dependencies && dependencies.length > 0) {
      this.checkCircularDependency(id, dependencies);
    }

    // Inherit sessionId from parent if not explicitly provided
    let sessionId = task.sessionId;
    if (!sessionId && task.parentTaskId) {
      const parentTask = this.state.tasks.get(task.parentTaskId);
      if (parentTask) {
        sessionId = parentTask.sessionId;
      }
    }
    
    const newTask: Task = {
      id,
      name: task.name,
      description: task.description,
      dependencies,
      softDependencies: task.softDependencies,
      dependencyTimeouts: task.dependencyTimeouts,
      externalDependencies: task.externalDependencies,
      conditionalDependencies: task.conditionalDependencies,
      parentTaskId: task.parentTaskId,
      sessionId,
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
   * @param options - Optional batch-level options (default deduplication strategy, etc.)
   * @returns Array of created or reused tasks
   * @throws DependencyNotFoundError if a dependency task doesn't exist
   * @throws Error if circular dependency is detected or duplicate is found with 'error' strategy
   *
   * This method supports both positional dependencies within a single batch and references
   * to existing task IDs:
   * 1. First pass: Deduplicate against existing tasks and create new tasks without dependencies
   * 2. Second pass: Resolve positional dependencies to actual task IDs, and validate existing IDs
   * 3. Third pass: Auto-add parentTaskId to dependencies if provided, inherit sessionId from parent
   * 4. Fourth pass: Validate dependencies and check for circular references
   *
   * Supported dependency formats:
   * - Positional: "task-1", "task-2", etc. (1-based index in the current batch)
   * - Existing task IDs: UUIDs of tasks already in the system
   *
   * Positional dependency example:
   * [
   *   { name: "Task A" },
   *   { name: "Task B", dependencies: ["task-1"] }
   * ]
   *
   * Mixed dependency example:
   * [
   *   { name: "Task A" },
   *   { name: "Task B", dependencies: ["<existing-task-id>"] }
   * ]
   *
   * Deduplication:
   * By default, a task is considered a duplicate if it has the same name, sessionId, and
   * parentTaskId as an existing task. The default behavior is 'none' (always create). Pass
   * deduplication: 'skip' (or 'reuse') to return the existing task instead of creating a
   * duplicate. Pass 'error' to throw when a duplicate exists.
   *
   * Note: If parentTaskId is provided, it is automatically added to the task's dependencies
   * to ensure the subtask only becomes ready after the parent is completed. Subtasks also
   * inherit sessionId from their parent if they don't specify one.
   */
  createTasks(
    tasks: CreateTaskInput[],
    options: { defaultDeduplication?: import('./types.js').DeduplicationStrategy } = {}
  ): Task[] {
    const defaultDeduplication = options.defaultDeduplication || 'none';
    const resultTasks: Task[] = [];
    const idMapping = new Map<string, string>(); // Maps input index -> task ID (for positional deps)

    // Helper: build a deduplication key from an input
    const dedupKey = (input: CreateTaskInput): string => {
      const sessionId = input.sessionId || (input.parentTaskId
        ? this.state.tasks.get(input.parentTaskId)?.sessionId
        : undefined) || '__no_session__';
      return `${input.name.toLowerCase()}|${sessionId}|${input.parentTaskId || '__no_parent__'}`;
    };

    // Helper: find existing duplicate task
    const findDuplicate = (input: CreateTaskInput): Task | undefined => {
      const key = dedupKey(input);
      for (const task of this.state.tasks.values()) {
        const taskKey = `${task.name.toLowerCase()}|${task.sessionId || '__no_session__'}|${task.parentTaskId || '__no_parent__'}`;
        if (taskKey === key) {
          return task;
        }
      }
      return undefined;
    };

    // First pass: Deduplicate and create tasks without dependencies
    for (let i = 0; i < tasks.length; i++) {
      const taskInput = tasks[i];

      // Validate parent task if specified
      if (taskInput.parentTaskId && !this.state.tasks.has(taskInput.parentTaskId)) {
        throw new TaskNotFoundError(taskInput.parentTaskId);
      }

      // Determine effective deduplication strategy
      const strategy = taskInput.deduplication || defaultDeduplication;

      // Check for duplicates if strategy is not 'none'
      if (strategy !== 'none') {
        const duplicate = findDuplicate(taskInput);
        if (duplicate) {
          if (strategy === 'error') {
            throw new ValidationError(
              `Duplicate task detected: '${taskInput.name}' already exists in session '${duplicate.sessionId || 'none'}' (ID: ${duplicate.id}). Use deduplication 'skip' to reuse it.`
            );
          }
          // 'skip' or 'reuse': return existing task
          resultTasks.push(duplicate);
          idMapping.set(String(i), duplicate.id);
          continue;
        }
      }

      const id = this.generateId();
      const now = new Date().toISOString();

      // Inherit sessionId from parent if not explicitly provided
      let sessionId = taskInput.sessionId;
      if (!sessionId && taskInput.parentTaskId) {
        const parentTask = this.state.tasks.get(taskInput.parentTaskId);
        if (parentTask) {
          sessionId = parentTask.sessionId;
        }
      }

      const newTask: Task = {
        id,
        name: taskInput.name,
        description: taskInput.description,
        dependencies: [], // Will be resolved in second pass
        softDependencies: taskInput.softDependencies,
        dependencyTimeouts: taskInput.dependencyTimeouts,
        externalDependencies: taskInput.externalDependencies,
        conditionalDependencies: taskInput.conditionalDependencies,
        parentTaskId: taskInput.parentTaskId,
        sessionId,
        metadata: taskInput.metadata,
        maxRetries: taskInput.maxRetries,
        timeoutMs: taskInput.timeoutMs,
        retries: 0,
        status: TASK_STATUS.PENDING,
        createdAt: now,
        updatedAt: now
      };

      // Store the task
      this.state.tasks.set(id, newTask);
      resultTasks.push(newTask);
      idMapping.set(String(i), id);
    }

    // Second pass: Resolve dependencies to actual task IDs
    // Supported formats:
    // 1. Positional reference: "task-1", "task-2", etc. (1-based index in this batch)
    // 2. Existing task ID (UUID already in state)
    // 3. Task name within this batch (case-insensitive match)
    // 4. Task name of an existing task in the system (case-insensitive match)
    for (let i = 0; i < tasks.length; i++) {
      const taskInput = tasks[i];
      const task = resultTasks[i];

      if (!taskInput.dependencies || taskInput.dependencies.length === 0) {
        continue;
      }

      const resolvedDependencies: string[] = [];

      for (const dep of taskInput.dependencies) {
        // Check if dependency is a positional reference (task-N format)
        const positionalMatch = dep.match(/^task-(\d+)$/);
        if (positionalMatch) {
          const index = parseInt(positionalMatch[1], 10) - 1; // Convert to 0-based index
          if (index >= 0 && index < tasks.length) {
            const mappedId = idMapping.get(String(index));
            if (mappedId) {
              resolvedDependencies.push(mappedId);
            } else {
              throw new DependencyNotFoundError(
                `Positional dependency '${dep}' references a task that was deduplicated and not created in this batch`
              );
            }
          } else {
            // Out of range positional index
            throw new DependencyNotFoundError(
              `Positional dependency '${dep}' is out of range (valid range: task-1 to task-${tasks.length})`
            );
          }
        } else if (this.state.tasks.has(dep)) {
          // Existing task ID reference
          resolvedDependencies.push(dep);
        } else {
          // Try matching by task name within this batch (case-insensitive)
          const batchMatchIndex = tasks.findIndex(
            t => t.name.toLowerCase() === dep.toLowerCase()
          );
          if (batchMatchIndex !== -1) {
            const mappedId = idMapping.get(String(batchMatchIndex));
            if (mappedId) {
              resolvedDependencies.push(mappedId);
              continue;
            }
          }

          // Try matching by task name among existing tasks in the system (case-insensitive)
          let existingNameMatch: Task | undefined;
          for (const existingTask of this.state.tasks.values()) {
            if (existingTask.name.toLowerCase() === dep.toLowerCase()) {
              existingNameMatch = existingTask;
              break;
            }
          }
          if (existingNameMatch) {
            resolvedDependencies.push(existingNameMatch.id);
          } else {
            throw new DependencyNotFoundError(
              `Dependency '${dep}' could not be resolved. Use 'task-N' for a positional reference, an existing task ID, or a task name (in this batch or existing).`
            );
          }
        }
      }

      // Update task with resolved dependencies
      task.dependencies = resolvedDependencies;
      this.state.tasks.set(task.id, task);
    }

    // Third pass: Check for circular dependencies
    for (let i = 0; i < resultTasks.length; i++) {
      const task = resultTasks[i];
      if (task.dependencies && task.dependencies.length > 0) {
        this.checkCircularDependency(task.id, task.dependencies);
      }

      // Validate all dependency IDs exist in state (defensive)
      for (const depId of task.dependencies) {
        if (!this.state.tasks.has(depId)) {
          throw new DependencyNotFoundError(depId);
        }
      }
    }

    this.triggerSave();
    return resultTasks;
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

    // Check if following dependencies from taskId leads back to itself
    // This works for both single task creation and batch creation
    const task = this.state.tasks.get(taskId);
    if (!task) {
      // Task not in state yet (single task creation scenario)
      // Use the old logic with temporary task
      const now = new Date().toISOString();
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
    } else {
      // Task is already in state (batch creation scenario)
      // Just check if following dependencies leads back to taskId
      if (hasCycle(taskId)) {
        throw new Error(`Circular dependency detected involving task ${taskId}`);
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

    // Check if all hard dependencies are completed
    for (const depId of task.dependencies) {
      const depTask = this.state.tasks.get(depId);
      if (!depTask) {
        return { canExecute: false, reason: `Dependency ${depId} not found` };
      }
      if (depTask.status !== TASK_STATUS.COMPLETED) {
        // Check if dependency has a timeout and has exceeded it
        if (task.dependencyTimeouts && task.dependencyTimeouts[depId]) {
          const timeoutMs = task.dependencyTimeouts[depId];
          const depCreatedAt = new Date(depTask.createdAt).getTime();
          const elapsed = Date.now() - depCreatedAt;
          if (elapsed > timeoutMs) {
            // Dependency timeout exceeded - allow execution despite incomplete dependency
            continue;
          }
        }
        return { canExecute: false, reason: `Dependency ${depId} is ${depTask.status}` };
      }
    }

    // Soft dependencies are checked but don't block execution
    // They're logged as warnings but don't prevent execution
    if (task.softDependencies && task.softDependencies.length > 0) {
      const unmetSoftDeps: string[] = [];
      for (const softDepId of task.softDependencies) {
        const softDepTask = this.state.tasks.get(softDepId);
        if (!softDepTask || softDepTask.status !== TASK_STATUS.COMPLETED) {
          unmetSoftDeps.push(softDepId);
        }
      }
      if (unmetSoftDeps.length > 0) {
        // Soft dependencies not met, but allow execution
        // The reason will be informational only
        return {
          canExecute: true,
          reason: `Note: Soft dependencies not met: ${unmetSoftDeps.join(', ')}. Execution will proceed.`
        };
      }
    }

    // Check external dependencies (API/health checks)
    // Note: External dependencies are skipped in synchronous check
    // Use canExecuteTaskWithExternalChecks for full validation including external deps
    if (task.externalDependencies && task.externalDependencies.length > 0) {
      // For now, we skip external dependency checks in the synchronous version
      // to maintain backward compatibility
      // This could be enhanced with a flag to enable/disable external checks
    }

    // Check conditional dependencies (if/else logic)
    if (task.conditionalDependencies && task.conditionalDependencies.length > 0) {
      for (const condDep of task.conditionalDependencies) {
        const shouldExecute = this.evaluateCondition(condDep.condition);
        if (shouldExecute) {
          // Condition is true, check if the conditional dependency task is completed
          const condTask = this.state.tasks.get(condDep.taskId);
          if (!condTask) {
            return { canExecute: false, reason: `Conditional dependency task ${condDep.taskId} not found` };
          }
          if (condTask.status !== TASK_STATUS.COMPLETED) {
            return { canExecute: false, reason: `Conditional dependency ${condDep.taskId} is ${condTask.status}` };
          }
        }
        // If condition is false, the dependency is not required
      }
    }

    return { canExecute: true };
  }

  /**
   * Check if an external dependency is available/healthy
   * @param extDep - External dependency to check
   * @returns True if dependency is available
   */
  private async checkExternalDependency(extDep: { type: string; url: string; timeoutMs?: number }): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = extDep.timeoutMs || 5000; // Default 5s timeout
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(extDep.url, {
        method: extDep.type === 'health' ? 'GET' : 'HEAD',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      // Consider 2xx and 3xx as healthy
      return response.status >= 200 && response.status < 400;
    } catch (error) {
      // Network error or timeout - dependency not available
      return false;
    }
  }

  /**
   * Evaluate a condition string
   * @param condition - Condition string to evaluate
   * @returns True if condition evaluates to true
   */
  private evaluateCondition(condition: string): boolean {
    // Simple condition evaluation - can be extended for more complex logic
    // For now, support basic comparisons against task metadata or environment

    // Check if condition references a task's metadata
    // Format: task.{taskId}.metadata.{field} == "value"
    const taskMatch = condition.match(/^task\.([^.]+)\.metadata\.([^.]+)\s*(==|!=|>|<|>=|<=)\s*"(.+)"$/);
    if (taskMatch) {
      const [, taskId, field, operator, value] = taskMatch;
      const task = this.state.tasks.get(taskId);
      if (!task) return false;

      const taskValue = task.metadata?.[field];
      if (taskValue === undefined) return false;

      // Simple comparison
      switch (operator) {
        case '==': return String(taskValue) === value;
        case '!=': return String(taskValue) !== value;
        case '>': return Number(taskValue) > Number(value);
        case '<': return Number(taskValue) < Number(value);
        case '>=': return Number(taskValue) >= Number(value);
        case '<=': return Number(taskValue) <= Number(value);
        default: return false;
      }
    }

    // Check environment variables
    const envMatch = condition.match(/^env\.([^.]+)\s*(==|!=)\s*"(.+)"$/);
    if (envMatch) {
      const [, varName, operator, value] = envMatch;
      const envValue = process.env[varName];
      if (envValue === undefined) return false;

      switch (operator) {
        case '==': return envValue === value;
        case '!=': return envValue !== value;
        default: return false;
      }
    }

    // Default: treat as boolean expression
    return condition === 'true';
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
   * Check if a task has incomplete subtasks
   * @param taskId - Task ID to check
   * @returns True if task has subtasks that are not completed
   */
  private hasIncompleteSubtasks(taskId: string): boolean {
    const subtasks = this.getSubtasks(taskId);
    return subtasks.some(subtask => 
      subtask.status !== TASK_STATUS.COMPLETED && subtask.status !== TASK_STATUS.FAILED
    );
  }

  /**
   * Execute a task (mark as completed with result)
   * @param taskId - Task ID to execute
   * @param result - Optional execution result
   * @returns The executed task or null if cannot be executed
   */
  executeTask(taskId: string, result?: unknown): Task | null {
    const task = this.state.tasks.get(taskId);
    if (!task) {
      return null;
    }

    // Parent tasks cannot complete until all subtasks are complete
    if (this.hasIncompleteSubtasks(taskId)) {
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

    // Parent tasks cannot fail until all subtasks are complete or failed
    if (this.hasIncompleteSubtasks(taskId)) {
      return null;
    }

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
   * Check if a task can be executed including external dependency checks (async)
   * @param taskId - Task ID to check
   * @returns Execution check result with reason if not executable
   */
  async canExecuteTaskWithExternalChecks(taskId: string): Promise<TaskExecutionResult> {
    // First do the synchronous checks
    const syncResult = this.canExecuteTask(taskId);
    if (!syncResult.canExecute) {
      return syncResult;
    }

    const task = this.state.tasks.get(taskId);
    if (!task) {
      return { canExecute: false, reason: 'Task not found' };
    }

    // Check external dependencies (API/health checks)
    if (task.externalDependencies && task.externalDependencies.length > 0) {
      for (const extDep of task.externalDependencies) {
        const isHealthy = await this.checkExternalDependency(extDep);
        if (!isHealthy) {
          return {
            canExecute: false,
            reason: `External dependency ${extDep.type} at ${extDep.url} is not available`
          };
        }
      }
    }

    return { canExecute: true };
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
  async clearAll(): Promise<void> {
    this.state.tasks.clear();
    this.state.workflows.clear();
    this.state.workflowRuns.clear();
    await this.storageAdapter.clear();
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
   * Clean up hanging, orphaned, or stale tasks.
   * @param options - Cleanup options
   * @returns Summary of cleanup actions taken
   *
   * Identifies and optionally deletes:
   * - Orphaned subtasks: tasks with parentTaskId pointing to a non-existent parent
   * - Parent-completed subtasks: subtasks whose parent is completed but subtasks are still pending
   * - Duplicate tasks: tasks with the same name/sessionId/parentTaskId as another (keeps oldest)
   * - Stale pending tasks: pending tasks that have not been started within the given age threshold
   */
  cleanupTasks(options: {
    deleteOrphans?: boolean;
    deleteParentCompleted?: boolean;
    deleteDuplicates?: boolean;
    deleteStalePending?: boolean;
    stalePendingMs?: number;
  } = {}): import('./types.js').TaskCleanupResult {
    const {
      deleteOrphans = false,
      deleteParentCompleted = false,
      deleteDuplicates = false,
      deleteStalePending = false,
      stalePendingMs = 24 * 60 * 60 * 1000 // 24 hours default
    } = options;

    const now = Date.now();
    const allTasks = this.getAllTasks();
    const taskIdsToDelete = new Set<string>();
    const details: import('./types.js').TaskCleanupResult['details'] = [];

    let orphanedSubtasks = 0;
    let parentCompletedCount = 0;
    let duplicateTasks = 0;
    let stalePendingTasks = 0;

    // Find orphaned subtasks and subtasks with completed parents
    for (const task of allTasks) {
      if (!task.parentTaskId) continue;

      const parent = this.state.tasks.get(task.parentTaskId);
      if (!parent) {
        orphanedSubtasks++;
        if (deleteOrphans) {
          taskIdsToDelete.add(task.id);
          details.push({ id: task.id, name: task.name, reason: 'orphaned_subtask' });
        }
        continue;
      }

      if (parent.status === TASK_STATUS.COMPLETED && task.status === TASK_STATUS.PENDING) {
        parentCompletedCount++;
        if (deleteParentCompleted) {
          taskIdsToDelete.add(task.id);
          details.push({ id: task.id, name: task.name, reason: 'parent_completed' });
        }
      }
    }

    // Find duplicate tasks: same name, sessionId, parentTaskId (keep oldest createdAt)
    const seen = new Map<string, Task>();
    const sortedByAge = [...allTasks].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    for (const task of sortedByAge) {
      const key = `${task.name.toLowerCase()}|${task.sessionId || '__no_session__'}|${task.parentTaskId || '__no_parent__'}`;
      if (seen.has(key)) {
        duplicateTasks++;
        if (deleteDuplicates) {
          taskIdsToDelete.add(task.id);
          details.push({ id: task.id, name: task.name, reason: 'duplicate' });
        }
      } else {
        seen.set(key, task);
      }
    }

    // Find stale pending tasks
    if (deleteStalePending) {
      for (const task of allTasks) {
        if (task.status !== TASK_STATUS.PENDING) continue;
        if (taskIdsToDelete.has(task.id)) continue; // Already scheduled for deletion

        const createdTime = new Date(task.createdAt).getTime();
        if (now - createdTime > stalePendingMs) {
          stalePendingTasks++;
          taskIdsToDelete.add(task.id);
          details.push({ id: task.id, name: task.name, reason: 'stale_pending' });
        }
      }
    }

    // Delete tasks that are not part of any workflow (extra safety: only delete pending hanging tasks)
    for (const taskId of taskIdsToDelete) {
      this.state.tasks.delete(taskId);
    }

    if (taskIdsToDelete.size > 0) {
      this.triggerSave();
    }

    return {
      deleted: taskIdsToDelete.size,
      orphanedSubtasks,
      parentCompleted: parentCompletedCount,
      stalePendingTasks,
      duplicateTasks,
      details
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
   * Check for task timeouts and fail them if exceeded
   * @param task - Task to check
   * @returns True if task timed out and was failed
   */
  private checkTaskTimeout(task: Task): boolean {
    if (task.status === TASK_STATUS.IN_PROGRESS && task.timeoutMs && task.startedAt) {
      const startedTime = new Date(task.startedAt).getTime();
      const currentTime = Date.now();
      const elapsed = currentTime - startedTime;
      
      if (elapsed > task.timeoutMs) {
        this.failTask(task.id, `Task timed out after ${elapsed}ms (timeout: ${task.timeoutMs}ms)`);
        return true;
      }
    }
    return false;
  }

  /**
   * Check if a task can be retried
   * @param task - Task to check
   * @returns True if task can be retried
   */
  private canRetryTask(task: Task): boolean {
    return task.maxRetries !== undefined && task.retries !== undefined && task.retries < task.maxRetries;
  }

  /**
   * Process active tasks to find newly completed or failed tasks
   * @param activeTaskIds - Currently active task IDs
   * @param completedTaskIds - Already completed task IDs in the workflow
   * @param workflowTaskIds - All task IDs in the workflow
   * @param continueOnFailure - Whether to continue on task failures
   * @returns Object with newly completed and failed task IDs
   */
  private processActiveTasks(
    activeTaskIds: string[],
    completedTaskIds: string[],
    workflowTaskIds: string[],
    continueOnFailure: boolean
  ): { newlyCompleted: string[]; newlyFailed: string[] } {
    const newlyCompleted: string[] = [];
    const newlyFailed: string[] = [];

    // Check active tasks for completion/failure
    for (const activeTaskId of activeTaskIds) {
      const task = this.state.tasks.get(activeTaskId);
      if (!task) continue;

      // Check for timeout first
      if (this.checkTaskTimeout(task)) {
        newlyCompleted.push(activeTaskId);
        continue;
      }

      if (task.status === TASK_STATUS.COMPLETED) {
        newlyCompleted.push(activeTaskId);
      } else if (task.status === TASK_STATUS.FAILED) {
        if (this.canRetryTask(task)) {
          // Can be retried, don't mark as failed for workflow
          continue;
        }
        newlyFailed.push(activeTaskId);
      }
    }

    // Also check for tasks that were manually completed/failed outside of workflow
    // These are tasks in the workflow that are completed/failed but not in completedTaskIds
    for (const taskId of workflowTaskIds) {
      if (completedTaskIds.includes(taskId) || activeTaskIds.includes(taskId)) {
        continue; // Already tracked (completed) or handled in first loop (active)
      }

      const task = this.state.tasks.get(taskId);
      if (!task) continue;

      if (task.status === TASK_STATUS.COMPLETED) {
        newlyCompleted.push(taskId);
      } else if (task.status === TASK_STATUS.FAILED) {
        if (this.canRetryTask(task)) {
          continue;
        }
        newlyFailed.push(taskId);
      }
    }

    return { newlyCompleted, newlyFailed };
  }

  /**
   * Find tasks that are ready to execute
   * @param workflow - Workflow definition
   * @param completedTaskIds - IDs of completed tasks
   * @param activeTaskIds - IDs of currently active tasks
   * @returns Object with ready tasks and blocked task IDs
   */
  private findReadyTasks(
    workflow: Workflow,
    completedTaskIds: string[],
    activeTaskIds: string[]
  ): { readyTasks: Task[]; blockedTaskIds: string[] } {
    const readyTasks: Task[] = [];
    const blockedTaskIds: string[] = [];

    for (const taskId of workflow.taskIds) {
      // Skip if already completed or active
      if (completedTaskIds.includes(taskId) || activeTaskIds.includes(taskId)) {
        continue;
      }

      const task = this.state.tasks.get(taskId);
      if (!task) {
        blockedTaskIds.push(taskId);
        continue;
      }

      const canExecute = this.canExecuteTask(taskId);
      if (canExecute.canExecute) {
        readyTasks.push(task);
        this.markTaskInProgress(taskId);
      } else {
        blockedTaskIds.push(taskId);
      }
    }

    return { readyTasks, blockedTaskIds };
  }

  /**
   * Determine if workflow should be marked as failed
   * @param workflow - Workflow definition
   * @param completedTaskIds - IDs of completed tasks
   * @param continueOnFailure - Whether to continue on failures
   * @returns True if workflow should be failed
   */
  private shouldFailWorkflow(
    workflow: Workflow,
    completedTaskIds: string[],
    continueOnFailure: boolean
  ): boolean {
    if (continueOnFailure) {
      return false;
    }

    // Get all failed tasks in this workflow
    const failedTaskIds = workflow.taskIds.filter(taskId => {
      const task = this.state.tasks.get(taskId);
      return task && task.status === TASK_STATUS.FAILED;
    });

    if (failedTaskIds.length === 0) {
      return false;
    }

    // Check if there is still at least one task that can be executed
    const canStillExecute = workflow.taskIds.some(taskId => {
      // Skip already completed tasks
      if (completedTaskIds.includes(taskId)) return false;

      const task = this.state.tasks.get(taskId);
      if (!task) return false;

      // Failed tasks cannot be executed
      if (task.status === TASK_STATUS.FAILED) return false;

      // Tasks that are in_progress are already executing, so they represent a valid path
      if (task.status === TASK_STATUS.IN_PROGRESS) return true;

      // Check if this task can now be executed
      return this.canExecuteTask(taskId).canExecute;
    });

    // Fail the workflow only if NO tasks can be executed anymore
    return !canStillExecute;
  }

  /**
   * Advance workflow run by finding newly unlocked tasks
   * @param runId - Workflow run ID
   * @returns Object with detailed workflow advancement information, or null if not found
   */
  advanceWorkflowRun(runId: string): {
    run: WorkflowRun;
    completedTasks: Task[];
    failedTasks: Task[];
    newlyReadyTasks: Task[];
    blockedTasks: Task[];
    workflowStatus: WorkflowRunStatus;
    message: string;
  } | null {
    const run = this.state.workflowRuns.get(runId);
    if (!run) return null;

    const workflow = this.state.workflows.get(run.workflowId);
    if (!workflow) return null;

    const continueOnFailure = run.continueOnFailure || false;

    // Process active tasks to find newly completed/failed
    const { newlyCompleted, newlyFailed } = this.processActiveTasks(
      run.activeTaskIds,
      run.completedTaskIds,
      workflow.taskIds,
      continueOnFailure
    );

    // Update completed and active task lists
    const updatedCompleted = [...run.completedTaskIds, ...newlyCompleted];
    const updatedActive = run.activeTaskIds.filter(id => !newlyCompleted.includes(id) && !newlyFailed.includes(id));

    // Find newly ready tasks
    const { readyTasks, blockedTaskIds } = this.findReadyTasks(workflow, updatedCompleted, updatedActive);

    // Update active tasks with newly ready tasks
    const updatedActiveTaskIds = [...updatedActive, ...readyTasks.map(t => t.id)];
    const updatedBlockedTaskIds = [...run.blockedTaskIds.filter(id => !readyTasks.map(t => t.id).includes(id)), ...blockedTaskIds];

    // Determine workflow status
    let workflowStatus: WorkflowRunStatus = 'in_progress';
    let errorMessage: string | undefined;

    // Check if workflow should be failed
    if (this.shouldFailWorkflow(workflow, updatedCompleted, continueOnFailure)) {
      workflowStatus = 'failed';
      errorMessage = `Workflow failed due to task failures`;
    } else if (workflow.taskIds.every((taskId: string) => updatedCompleted.includes(taskId))) {
      workflowStatus = 'completed';
    } else if (newlyFailed.length > 0 && continueOnFailure) {
      // Continue despite failures
      workflowStatus = 'in_progress';
    }

    // Build updated run
    const updatedRun: WorkflowRun = {
      ...run,
      status: workflowStatus,
      completedTaskIds: updatedCompleted,
      activeTaskIds: updatedActiveTaskIds,
      blockedTaskIds: updatedBlockedTaskIds,
      error: errorMessage,
      completedAt: workflowStatus === 'completed' || workflowStatus === 'failed' ? new Date().toISOString() : undefined
    };

    this.state.workflowRuns.set(runId, updatedRun);

    // Get task objects for return value
    const completedTasks = updatedCompleted.map(id => this.state.tasks.get(id)).filter((t): t is Task => t !== undefined);
    const failedTasks = newlyFailed.map(id => this.state.tasks.get(id)).filter((t): t is Task => t !== undefined);
    // Return only tasks that are currently blocked (not completed, not active, not ready, not failed)
    const blockedTasks = workflow.taskIds
      .filter(id => 
        !updatedCompleted.includes(id) && 
        !updatedActiveTaskIds.includes(id) &&
        !newlyFailed.includes(id)
      )
      .map(id => this.state.tasks.get(id))
      .filter((t): t is Task => t !== undefined);

    // Build human-readable message
    const messageParts: string[] = [];
    if (workflowStatus === 'completed') {
      messageParts.push('Workflow completed successfully');
    } else if (workflowStatus === 'failed') {
      messageParts.push(`Workflow failed: ${errorMessage}`);
    } else {
      messageParts.push('Workflow in progress');
    }
    messageParts.push(`${completedTasks.length} tasks completed`);
    if (failedTasks.length > 0) {
      messageParts.push(`${failedTasks.length} tasks failed`);
    }
    messageParts.push(`${readyTasks.length} new tasks ready`);
    messageParts.push(`${blockedTasks.length} tasks blocked`);

    return {
      run: updatedRun,
      completedTasks,
      failedTasks,
      newlyReadyTasks: readyTasks,
      blockedTasks,
      workflowStatus,
      message: messageParts.join('. ')
    };
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
   * Find the active workflow run for a given task
   * @param taskId - Task ID to search for
   * @returns Workflow run ID if task is in an active workflow, null otherwise
   */
  findActiveWorkflowRunForTask(taskId: string): string | null {
    for (const [runId, run] of this.state.workflowRuns.entries()) {
      // Check if task is in this workflow and the run is still active
      if (run.status === 'in_progress' && run.activeTaskIds.includes(taskId)) {
        return runId;
      }
    }
    return null;
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
