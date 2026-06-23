/**
 * Task status enumeration
 */
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

/**
 * Task interface representing a single task in the system
 */
export interface Task {
  id: string;
  name: string;
  description?: string;
  status: TaskStatus;
  dependencies: string[];
  parentTaskId?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  retries?: number;
  maxRetries?: number;
  timeoutMs?: number;
  result?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Task creation input (without auto-generated fields)
 */
export interface CreateTaskInput {
  name: string;
  description?: string;
  dependencies?: string[];
  parentTaskId?: string;
  metadata?: Record<string, unknown>;
  maxRetries?: number;
  timeoutMs?: number;
}

/**
 * Task update input (partial update)
 */
export interface UpdateTaskInput {
  name?: string;
  description?: string;
  status?: TaskStatus;
  dependencies?: string[];
  parentTaskId?: string;
  metadata?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  retries?: number;
  timeoutMs?: number;
  updatedAt?: string;
}

/**
 * Workflow run status enumeration
 */
export type WorkflowRunStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

/**
 * Workflow run interface representing a workflow execution instance
 * Supports both linear and DAG-based workflow execution
 */
export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: WorkflowRunStatus;
  // Track task states within this workflow run
  completedTaskIds: string[];
  activeTaskIds: string[];
  blockedTaskIds: string[];
  startedAt?: string;
  completedAt?: string;
  error?: string;
  continueOnFailure?: boolean; // If true, workflow continues even if some tasks fail
}

/**
 * Workflow interface representing a workflow definition
 */
export interface Workflow {
  id: string;
  name: string;
  taskIds: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Sequential state structure
 */
export interface SequentialState {
  tasks: Map<string, Task>;
  workflows: Map<string, Workflow>;
  workflowRuns: Map<string, WorkflowRun>;
}

/**
 * Workflow creation input
 */
export interface CreateWorkflowInput {
  name: string;
  taskIds: string[];
}

/**
 * Task execution result
 */
export interface TaskExecutionResult {
  canExecute: boolean;
  reason?: string;
}

/**
 * Statistics about tasks and workflows
 */
export interface TaskStats {
  totalTasks: number;
  pending: number;
  inProgress: number;
  completed: number;
  failed: number;
  totalWorkflows: number;
}

/**
 * Configuration interface
 */
export interface SequentialConfig {
  storagePath: string;
  outputDir: string;
  autoSave: boolean;
  saveDebounceMs: number;
}

/**
 * Log entry structure
 */
export interface LogEntry {
  timestamp: string;
  tool: string;
  arguments: Record<string, unknown>;
  result: unknown;
}
