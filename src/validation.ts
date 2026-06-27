import { z } from 'zod';
import type { TaskStatus } from './types.js';

/**
 * Zod schema for task status validation
 */
const TaskStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'failed']);

/**
 * Zod schema for RichDependency metadata
 */
const DependencyMetadataSchema = z.object({
  reason: z.string().optional(),
  createdBy: z.enum(['user', 'agent', 'system']).optional(),
  createdAt: z.string().optional(),
  priorityBoost: z.number().int().min(0).optional()
}).optional();

/**
 * Zod schema for RichDependency
 * Supports both shorthand (string) and full object forms
 */
const RichDependencySchema: z.ZodType = z.union([
  // Shorthand: string (task ID or positional ref)
  z.string().min(1),
  // Full RichDependency object
  z.object({
    taskId: z.string().min(1, 'Task ID is required'),
    type: z.enum(['hard', 'soft', 'conditional', 'external']).default('hard'),
    onFailure: z.enum(['block', 'skip', 'proceed']).optional(),
    condition: z.string().optional(),
    url: z.string().url('Invalid URL format').optional(),
    timeoutMs: z.number().int().min(0).optional(),
    metadata: DependencyMetadataSchema
  })
]);

/**
 * Zod schema for deduplication strategy
 */
export const DeduplicationStrategySchema = z.enum(['skip', 'reuse', 'error', 'none']).optional();

/**
 * Zod schema for creating a task
 */
export const CreateTaskSchema = z.object({
  name: z.string().min(1, 'Task name is required').max(255, 'Task name must be less than 255 characters'),
  description: z.string().max(1000, 'Description must be less than 1000 characters').optional().nullable(),
  dependencies: z.array(RichDependencySchema).default([]),
  priority: z.number().int().min(0).optional(),
  order: z.number().int().min(0).optional(),
  parentTaskId: z.string().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  maxRetries: z.number().int().min(0).optional(),
  timeoutMs: z.number().int().min(0).optional(),
  deduplication: DeduplicationStrategySchema
});

/**
 * Zod schema for creating multiple tasks (batch)
 */
export const CreateTasksSchema = z.object({
  tasks: z.array(CreateTaskSchema).min(1, 'At least one task is required')
});

/**
 * Zod schema for updating a task
 */
export const UpdateTaskSchema = z.object({
  id: z.string().min(1, 'Task ID is required'),
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional().nullable(),
  dependencies: z.array(RichDependencySchema).optional(),
  priority: z.number().int().min(0).optional(),
  order: z.number().int().min(0).optional(),
  parentTaskId: z.string().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  timeoutMs: z.number().int().min(0).optional()
});

/**
 * Zod schema for task ID
 */
export const TaskIdSchema = z.string().min(1, 'Task ID is required');

/**
 * Zod schema for workflow ID
 */
export const WorkflowIdSchema = z.string().min(1, 'Workflow ID is required');

/**
 * Zod schema for cleanup workflow runs
 */
export const CleanupWorkflowRunsSchema = z.object({
  maxAgeMs: z.number().int().min(0).optional(),
  maxCount: z.number().int().min(1).optional()
});

/**
 * Zod schema for cleaning up hanging/orphaned tasks
 */
export const CleanupTasksSchema = z.object({
  deleteOrphans: z.boolean().optional(),
  deleteParentCompleted: z.boolean().optional(),
  deleteDuplicates: z.boolean().optional(),
  deleteStalePending: z.boolean().optional(),
  stalePendingMs: z.number().int().min(0).optional()
});

/**
 * Zod schema for creating a workflow
 */
export const CreateWorkflowSchema = z.object({
  name: z.string().min(1, 'Workflow name is required').max(255, 'Workflow name must be less than 255 characters'),
  taskIds: z.array(z.string().min(1)).min(1, 'At least one task ID is required')
});

/**
 * Zod schema for task status filter
 */
export const TaskStatusFilterSchema = z.enum(['pending', 'in_progress', 'completed', 'failed']).optional();

/**
 * Zod schema for completing a task
 */
export const CompleteTaskSchema = z.object({
  id: z.string().min(1, 'Task ID is required'),
  result: z.unknown().optional(),
  autoAdvance: z.boolean().optional().default(true)
});

/**
 * Zod schema for failing a task
 */
export const FailTaskSchema = z.object({
  id: z.string().min(1, 'Task ID is required'),
  error: z.string().min(1, 'Error message is required'),
  autoAdvance: z.boolean().optional().default(true)
});

/**
 * Zod schema for starting a task
 */
export const StartTaskSchema = z.object({
  id: z.string().min(1, 'Task ID is required')
});

/**
 * Zod schema for resetting a task
 */
export const ResetTaskSchema = z.object({
  id: z.string().min(1, 'Task ID is required')
});

/**
 * Zod schema for retrying a task
 */
export const RetryTaskSchema = z.object({
  id: z.string().min(1, 'Task ID is required')
});

/**
 * Zod schema for checking if task can execute
 */
export const CanExecuteSchema = z.object({
  id: z.string().min(1, 'Task ID is required')
});

/**
 * Zod schema for starting workflow execution
 */
export const StartWorkflowExecutionSchema = z.object({
  workflowId: z.string().min(1, 'Workflow ID is required')
});

/**
 * Zod schema for advancing workflow run
 */
export const AdvanceWorkflowRunSchema = z.object({
  runId: z.string().min(1, 'Workflow run ID is required')
});

/**
 * Zod schema for getting workflow run
 */
export const GetWorkflowRunSchema = z.object({
  runId: z.string().min(1, 'Workflow run ID is required')
});

/**
 * Zod schema for getting next workflow tasks
 */
export const GetNextWorkflowTasksSchema = z.object({
  workflowId: z.string().min(1, 'Workflow ID is required')
});

/**
 * Type inference for create task input
 */
export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;

/**
 * Type inference for update task input
 */
export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;

/**
 * Type inference for create workflow input
 */
export type CreateWorkflowInput = z.infer<typeof CreateWorkflowSchema>;

/**
 * Type inference for execute task input
 */
export type CompleteTaskInput = z.infer<typeof CompleteTaskSchema>;

/**
 * Type inference for fail task input
 */
export type FailTaskInput = z.infer<typeof FailTaskSchema>;

/**
 * Zod schema for adding a dependency
 */
export const AddDependencySchema = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
  dependency: RichDependencySchema
});

/**
 * Zod schema for removing a dependency
 */
export const RemoveDependencySchema = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
  depTaskId: z.string().min(1, 'Dependency task ID is required')
});

/**
 * Zod schema for updating a dependency
 */
export const UpdateDependencySchema = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
  depTaskId: z.string().min(1, 'Dependency task ID is required'),
  updates: z.object({
    type: z.enum(['hard', 'soft', 'conditional', 'external']).optional(),
    onFailure: z.enum(['block', 'skip', 'proceed']).optional(),
    condition: z.string().optional(),
    url: z.string().url('Invalid URL format').optional(),
    timeoutMs: z.number().int().min(0).optional(),
    metadata: DependencyMetadataSchema
  }).optional()
});

/**
 * Zod schema for moving a task
 */
export const MoveTaskSchema = z.object({
  taskId: z.string().min(1, 'Task ID is required'),
  newParentTaskId: z.string().nullable().optional(),
  position: z.number().int().min(0).optional()
});

/**
 * Zod schema for getting dependency graph
 */
export const GetDependencyGraphSchema = z.object({
  workflowId: z.string().optional()
});

/**
 * Zod schema for exporting Mermaid diagram
 */
export const ExportMermaidSchema = z.object({
  workflowId: z.string().optional(),
  format: z.enum(['mmd', 'png', 'svg']).default('png')
});

/**
 * Zod schema for exporting graph as image
 */
export const ExportGraphImageSchema = z.object({
  workflowId: z.string().optional(),
  format: z.enum(['png', 'svg']).default('png')
});

/**
 * Zod schema for getting blocked tasks
 */
export const GetBlockedTasksSchema = z.object({
  workflowId: z.string().optional()
});

/**
 * Zod schema for getting critical path
 */
export const GetCriticalPathSchema = z.object({
  workflowId: z.string().min(1, 'Workflow ID is required')
});

/**
 * Zod schema for exporting workflow bundle
 */
export const ExportWorkflowBundleSchema = z.object({
  workflowId: z.string().min(1, 'Workflow ID is required'),
  includeRuns: z.boolean().optional()
});

/**
 * Zod schema for importing workflow bundle
 */
export const ImportWorkflowBundleSchema = z.object({
  bundle: z.object({
    workflow: z.object({
      id: z.string(),
      name: z.string().min(1),
      taskIds: z.array(z.string()),
      createdAt: z.string(),
      updatedAt: z.string(),
      version: z.string().optional(),
      tags: z.array(z.string()).optional(),
      templateDescription: z.string().optional()
    }).strict(),
    tasks: z.array(z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      description: z.string().optional(),
      status: TaskStatusSchema,
      dependencies: z.array(RichDependencySchema),
      priority: z.number().int().optional(),
      order: z.number().int().optional(),
      parentTaskId: z.string().optional(),
      createdAt: z.string(),
      updatedAt: z.string(),
      startedAt: z.string().optional(),
      completedAt: z.string().optional(),
      retries: z.number().int().optional(),
      maxRetries: z.number().int().optional(),
      timeoutMs: z.number().int().optional(),
      result: z.unknown().optional(),
      error: z.string().optional(),
      metadata: z.record(z.string(), z.unknown()).optional()
    })).min(1, 'At least one task is required'),
    version: z.string().min(1, 'Bundle version is required'),
    exportedAt: z.string(),
    templateName: z.string().optional(),
    tags: z.array(z.string()).optional()
  }),
  namePrefix: z.string().optional(),
  deduplication: DeduplicationStrategySchema
});
