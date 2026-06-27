/**
 * Task status enumeration
 */
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

/**
 * Rich dependency model - unified replacement for all fragmented dependency fields
 */
export interface RichDependency {
  taskId: string;
  type: 'hard' | 'soft' | 'conditional' | 'external';
  onFailure?: 'block' | 'skip' | 'proceed';  // default: 'block'
  condition?: string;                          // for type: 'conditional'
  url?: string;                                // for type: 'external'
  timeoutMs?: number;
  metadata?: {
    reason?: string;
    createdBy?: 'user' | 'agent' | 'system';
    createdAt?: string;       // ISO timestamp
    priorityBoost?: number;   // influence on composite readinessScore
  };
}

/**
 * Task interface representing a single task in the system
 */
export interface Task {
  id: string;
  name: string;
  description?: string;
  status: TaskStatus;
  dependencies: RichDependency[];
  priority?: number;   // higher = more important; used in composite scheduling score
  order?: number;      // explicit position among siblings under same parent
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
 * Deduplication strategy for task creation
 */
export type DeduplicationStrategy = 'skip' | 'reuse' | 'error' | 'none';

/**
 * Task creation input (without auto-generated fields)
 */
export interface CreateTaskInput {
  name: string;
  description?: string;
  dependencies?: (string | RichDependency)[];
  priority?: number;
  order?: number;
  parentTaskId?: string;
  metadata?: Record<string, unknown>;
  maxRetries?: number;
  timeoutMs?: number;
  /**
   * Deduplication strategy for this task:
   * - 'skip': If a duplicate exists, skip creation and return existing task
   * - 'reuse': Same as skip (alias for clarity)
   * - 'error': If a duplicate exists, throw an error
   * - 'none': Always create a new task (default historical behavior)
   */
  deduplication?: DeduplicationStrategy;
}

/**
 * Task update input (partial update)
 */
export interface UpdateTaskInput {
  name?: string;
  description?: string;
  status?: TaskStatus;
  dependencies?: RichDependency[];
  priority?: number;
  order?: number;
  parentTaskId?: string;
  metadata?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  createdAt?: string;
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
  version?: string;
  tags?: string[];
  templateDescription?: string;
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
 * Readiness score breakdown for intelligent scheduling
 */
export interface ReadinessScore {
  score: number;  // 0-100 composite score
  breakdown: {
    hardDepsSatisfied: number;  // 0-60 points
    softDepsSatisfied: number;  // 0-20 points
    taskPriority: number;       // 0-10 points
    priorityBoost: number;      // -10 to +10 points
  };
}

/**
 * Task execution result
 */
export interface TaskExecutionResult {
  canExecute: boolean;
  reason?: string;
  readinessScore?: number;  // 0-100 composite score for scheduling
  readinessBreakdown?: ReadinessScore['breakdown'];  // Detailed breakdown
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
 * Result of a task cleanup operation
 */
export interface TaskCleanupResult {
  deleted: number;
  orphanedSubtasks: number;
  parentCompleted: number;
  stalePendingTasks: number;
  duplicateTasks: number;
  details: Array<{
    id: string;
    name: string;
    reason: 'orphaned_subtask' | 'stale_pending' | 'duplicate' | 'parent_completed';
  }>;
}

/**
 * Storage backend type
 */
export type StorageBackend = 'json' | 'sqlite';

/**
 * Configuration interface
 */
export interface SequentialConfig {
  storagePath: string;
  storageBackend: StorageBackend;
  outputDir: string;
  autoSave: boolean;
  saveDebounceMs: number;
}

/**
 * Log entry structure
 */
export interface LogEntry {
  timestamp: string;
  type: 'tool_request' | 'llm_response';
  tool?: string;
  arguments?: Record<string, unknown>;
  result?: unknown;
  content?: string;
  toolCalls?: any[];
  relatedTools?: string[];
}

/**
 * Workflow bundle for export/import functionality
 * Contains a complete workflow definition with all related tasks, subtasks, and dependencies
 */
export interface WorkflowBundle {
  workflow: Workflow;
  tasks: Task[];
  version: string;
  exportedAt: string;
  templateName?: string;
  tags?: string[];
}
