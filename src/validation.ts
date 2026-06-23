import { z } from 'zod';
import type { TaskStatus } from './types.js';

/**
 * Zod schema for task status validation
 */
const TaskStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'failed']);

/**
 * Zod schema for creating a task
 */
export const CreateTaskSchema = z.object({
  name: z.string().min(1, 'Task name is required').max(255, 'Task name must be less than 255 characters'),
  description: z.string().max(1000, 'Description must be less than 1000 characters').optional(),
  dependencies: z.array(z.string().min(1)).default([]),
  parentTaskId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  maxRetries: z.number().int().min(0).optional(),
  timeoutMs: z.number().int().min(0).optional()
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
  description: z.string().max(1000).optional(),
  dependencies: z.array(z.string().min(1)).optional(),
  parentTaskId: z.string().optional(),
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
 * Zod schema for executing a task
 */
export const ExecuteTaskSchema = z.object({
  id: z.string().min(1, 'Task ID is required'),
  result: z.unknown().optional()
});

/**
 * Zod schema for failing a task
 */
export const FailTaskSchema = z.object({
  id: z.string().min(1, 'Task ID is required'),
  error: z.string().min(1, 'Error message is required')
});

/**
 * Zod schema for marking task in progress
 */
export const MarkInProgressSchema = z.object({
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
export type ExecuteTaskInput = z.infer<typeof ExecuteTaskSchema>;

/**
 * Type inference for fail task input
 */
export type FailTaskInput = z.infer<typeof FailTaskSchema>;
