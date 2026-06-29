import { TaskOrchestratorService } from './taskOrchestratorService.js';
import { getLogger } from './logger.js';
import {
  ValidationError,
  TaskNotFoundError,
  WorkflowNotFoundError,
  TaskExecutionError,
  StrategyNotFoundError
} from './errors.js';
import type { Task } from './types.js';
import { renderMermaid } from './utils/mermaidRenderer.js';
import { createSuccessResponse, createErrorResponse } from './utils/response.js';
import fs from 'fs/promises';
import path from 'path';
import {
  CreateTaskSchema,
  CreateTasksSchema,
  UpdateTaskSchema,
  TaskIdSchema,
  CreateWorkflowSchema,
  CompleteTaskSchema,
  FailTaskSchema,
  StartTaskSchema,
  ResetTaskSchema,
  RetryTaskSchema,
  CanExecuteSchema,
  WorkflowIdSchema,
  StartWorkflowExecutionSchema,
  AdvanceWorkflowRunSchema,
  GetWorkflowRunSchema,
  GetNextWorkflowTasksSchema,
  CleanupWorkflowRunsSchema,
  CleanupTasksSchema,
  AddDependencySchema,
  RemoveDependencySchema,
  UpdateDependencySchema,
  MoveTaskSchema,
  GetDependencyGraphSchema,
  ExportMermaidSchema,
  VisualizeAsciiSchema,
  ExportGraphImageSchema,
  ExportStrategyMermaidSchema,
  GetBlockedTasksSchema,
  GetCriticalPathSchema,
  ExportWorkflowBundleSchema,
  ImportWorkflowBundleSchema,
  CreateStrategySchema,
  GetStrategySchema,
  ListStrategiesSchema,
  UpdateStrategySchema,
  DeleteStrategySchema,
  MoveWorkflowToStrategySchema,
  RemoveWorkflowFromStrategySchema,
  CloneWorkflowToStrategySchema,
  GetWorkflowsByStrategySchema
} from './validation.js';
import { ERROR_MESSAGES } from './constants.js';

/**
 * Tool handler context
 */
interface HandlerContext {
  service: TaskOrchestratorService;
  logger: ReturnType<typeof getLogger>;
}

/**
 * Create tasks handler (batch)
 */
export async function handleCreateTasks(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  // Validate input
  const validated = CreateTasksSchema.parse(args);

  // Convert null values to undefined for optional fields
  const normalizedTasks = validated.tasks.map(task => ({
    ...task,
    parentTaskId: task.parentTaskId ?? undefined,
    description: task.description ?? undefined,
    deduplication: task.deduplication ?? undefined
  }));

  // Default to skip deduplication for MCP-created tasks to avoid duplicate hanging tasks.
  // Callers can override per-task with deduplication: 'none' or 'error'.
  const tasks = service.createTasks(normalizedTasks, { defaultDeduplication: 'skip' });

  await service.forceSave();

  const taskSummaries = tasks.map(task => {
    let parentInfo = '';
    if (task.parentTaskId) {
      const parentTask = service.getTask(task.parentTaskId);
      if (parentTask) {
        parentInfo = `\n  **Parent Task:** ${parentTask.name} (ID: ${task.parentTaskId})`;
      } else {
        parentInfo = `\n  **Parent Task ID:** ${task.parentTaskId}`;
      }
    }
    return `- **${task.name}** (ID: ${task.id})${parentInfo}`;
  }).join('\n');

  const displayOutput = `✅ ${tasks.length} task(s) created successfully\n\n${taskSummaries}`;
  const data = {
    tasks: tasks.map(task => ({
      id: task.id,
      name: task.name,
      status: task.status,
      parentTaskId: task.parentTaskId
    }))
  };

  const result = createSuccessResponse(data, displayOutput, 'create_tasks');

  await logger.logToolRequest('create_tasks', args, result);
  return result;
}

/**
 * Update task handler
 */
export async function handleUpdateTask(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  // Validate input
  const validated = UpdateTaskSchema.parse(args);

  const updates: Record<string, unknown> = {};
  if (validated.name !== undefined) updates.name = validated.name;
  if (validated.description !== undefined) updates.description = validated.description ?? undefined;
  if (validated.dependencies !== undefined) updates.dependencies = validated.dependencies;
  if (validated.priority !== undefined) updates.priority = validated.priority;
  if (validated.order !== undefined) updates.order = validated.order;
  if (validated.parentTaskId !== undefined) updates.parentTaskId = validated.parentTaskId ?? undefined;
  if (validated.metadata !== undefined) updates.metadata = validated.metadata;

  const task = service.updateTask(validated.id, updates);
  
  if (!task) {
    throw new TaskNotFoundError(validated.id);
  }

  await service.forceSave();

  let parentInfo = '';
  if (task.parentTaskId) {
    const parentTask = service.getTask(task.parentTaskId);
    if (parentTask) {
      parentInfo = `\n**Parent Task:** ${parentTask.name} (ID: ${task.parentTaskId})`;
    } else {
      parentInfo = `\n**Parent Task ID:** ${task.parentTaskId}`;
    }
  }

  const displayOutput = `✅ Task updated successfully\n\n**Name:** ${task.name}\n**ID:** ${task.id}\n**Status:** ${task.status}${parentInfo}\n**Updated:** ${task.updatedAt}`;
  const data = {
    task: {
      id: task.id,
      name: task.name,
      status: task.status,
      parentTaskId: task.parentTaskId,
      updatedAt: task.updatedAt
    }
  };

  const result = createSuccessResponse(data, displayOutput, 'update_task');

  await logger.logToolRequest('update_task', args, result);
  return result;
}

/**
 * Delete task handler
 */
export async function handleDeleteTask(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  // Validate input
  const validated = TaskIdSchema.parse(args.id);

  const deleted = service.deleteTask(validated);
  
  if (!deleted) {
    throw new TaskNotFoundError(validated);
  }

  await service.forceSave();

  const displayOutput = `✅ Task deleted successfully\n\n**Deleted Task ID:** ${validated}`;
  const data = { deletedTaskId: validated };

  const result = createSuccessResponse(data, displayOutput, 'delete_task');

  await logger.logToolRequest('delete_task', args, result);
  return result;
}

/**
 * Get task handler
 */
export async function handleGetTask(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  // Validate input
  const validated = TaskIdSchema.parse(args.id);

  const task = service.getTask(validated);
  
  if (!task) {
    throw new TaskNotFoundError(validated);
  }

  let parentInfo = '';
  if (task.parentTaskId) {
    const parentTask = service.getTask(task.parentTaskId);
    if (parentTask) {
      parentInfo = `\n**Parent Task:** ${parentTask.name} (ID: ${task.parentTaskId})`;
    } else {
      parentInfo = `\n**Parent Task ID:** ${task.parentTaskId}`;
    }
  }

  // Get subtasks
  const subtasks = service.getSubtasks(task.id);
  let subtaskInfo = '';
  if (subtasks.length > 0) {
    subtaskInfo = `\n**Subtasks (${subtasks.length}):**\n${subtasks.map(st => `  - ${st.name} (${st.status})`).join('\n')}`;
  }

  const displayOutput = `📋 Task Details\n\n**Name:** ${task.name}\n**ID:** ${task.id}\n**Status:** ${task.status}${parentInfo}${subtaskInfo}\n**Created:** ${task.createdAt}\n**Updated:** ${task.updatedAt}`;
  const data = {
    task: {
      id: task.id,
      name: task.name,
      status: task.status,
      parentTaskId: task.parentTaskId,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      subtasks: subtasks.map(st => ({ id: st.id, name: st.name, status: st.status }))
    }
  };

  const result = createSuccessResponse(data, displayOutput, 'get_task');

  await logger.logToolRequest('get_task', args, result);
  return result;
}

/**
 * List tasks handler
 */
export async function handleListTasks(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  const status = args?.status as string | undefined;
  
  let tasks;
  if (status) {
    tasks = service.getTasksByStatus(status as any);
  } else {
    tasks = service.getAllTasks();
  }

  const completedCount = tasks.filter(t => t.status === 'completed').length;
  
  // Group tasks by parent/child relationship
  const parentTasks = tasks.filter(t => !t.parentTaskId);
  const childTasks = tasks.filter(t => t.parentTaskId);

  let taskList = '';

  // List parent tasks
  parentTasks.forEach(t => {
    const icon = t.status === 'completed' ? '✅' : '⚪';
    taskList += `${icon} ${t.name} (ID: ${t.id})\n`;

    // Then list its subtasks
    const subtasks = childTasks.filter(c => c.parentTaskId === t.id);
    if (subtasks.length > 0) {
      subtasks.forEach(st => {
        const subIcon = st.status === 'completed' ? '✅' : '⚪';
        taskList += `  ${subIcon} └─ ${st.name} (ID: ${st.id})\n`;
      });
    }
  });

  // List orphaned tasks (children whose parent doesn't exist in current list)
  const orphanedTasks = childTasks.filter(c => !parentTasks.find(p => p.id === c.parentTaskId));
  if (orphanedTasks.length > 0) {
    taskList += '\n[Orphaned subtasks (parent not in list)]\n';
    orphanedTasks.forEach(t => {
      const icon = t.status === 'completed' ? '✅' : '⚪';
      taskList += `${icon} ${t.name} (ID: ${t.id}) [Parent: ${t.parentTaskId}]\n`;
    });
  }

  const displayOutput = `${completedCount}/${tasks.length} tasks done\n\n${taskList}`;
  const data = {
    totalTasks: tasks.length,
    completedCount,
    status,
    tasks: tasks.map(t => ({
      id: t.id,
      name: t.name,
      status: t.status,
      parentTaskId: t.parentTaskId
    }))
  };

  const result = createSuccessResponse(data, displayOutput, 'list_tasks');

  await logger.logToolRequest('list_tasks', args, result);
  return result;
}

/**
 * Complete task handler
 */
export async function handleCompleteTask(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  // Validate input
  const validated = CompleteTaskSchema.parse(args);

  // Check if task exists
  const task = service.getTask(validated.id);
  if (!task) {
    throw new TaskNotFoundError(validated.id);
  }

  // Allow execution regardless of dependencies - mark as done
  const executedTask = service.executeTask(validated.id, validated.result);

  if (!executedTask) {
    throw new TaskExecutionError(validated.id, ERROR_MESSAGES.DEPENDENCY_NOT_MET);
  }

  await service.forceSave();

  // Check if task is in an active workflow and auto-advance is enabled
  let workflowInfo = '';
  let workflowData: any = null;
  if (validated.autoAdvance !== false) {
    const runId = service.findActiveWorkflowRunForTask(validated.id);
    if (runId) {
      const advanceResult = service.advanceWorkflowRun(runId);
      if (advanceResult) {
        // Build workflow advancement info
        workflowInfo = '\n\n🔄 **Workflow Auto-Advanced**\n\n';
        workflowInfo += `**Run ID:** ${runId}\n`;
        workflowInfo += `**Workflow Status:** ${advanceResult.workflowStatus}\n`;
        workflowInfo += `**Summary:** ${advanceResult.message}\n\n`;
        
        if (advanceResult.newlyReadyTasks.length > 0) {
          workflowInfo += `**New Ready Tasks (${advanceResult.newlyReadyTasks.length}):**\n`;
          advanceResult.newlyReadyTasks.forEach(t => {
            workflowInfo += `  - ${t.name} (ID: ${t.id})\n`;
          });
        }
        
        if (advanceResult.failedTasks.length > 0) {
          workflowInfo += `\n**Failed Tasks (${advanceResult.failedTasks.length}):**\n`;
          advanceResult.failedTasks.forEach(t => {
            workflowInfo += `  - ${t.name} (ID: ${t.id}) - Error: ${t.error}\n`;
          });
        }
        
        if (advanceResult.workflowStatus === 'completed') {
          workflowInfo += `\n✅ Workflow completed successfully!`;
        } else if (advanceResult.workflowStatus === 'failed') {
          workflowInfo += `\n❌ Workflow failed.`;
        }
        
        workflowData = {
          runId,
          workflowStatus: advanceResult.workflowStatus,
          newlyReadyTasks: advanceResult.newlyReadyTasks.map(t => ({ id: t.id, name: t.name })),
          failedTasks: advanceResult.failedTasks.map(t => ({ id: t.id, name: t.name, error: t.error }))
        };
        
        await service.forceSave();
      }
    }
  }

  // Format result safely to avoid JSON parsing issues
  let resultText = `✅ Task executed successfully\n\n**Name:** ${executedTask.name}\n**ID:** ${executedTask.id}\n**Status:** ${executedTask.status}`;
  if (executedTask.completedAt) {
    resultText += `\n**Completed:** ${executedTask.completedAt}`;
  }
  resultText += workflowInfo;

  const data = {
    task: {
      id: executedTask.id,
      name: executedTask.name,
      status: executedTask.status,
      completedAt: executedTask.completedAt
    },
    workflow: workflowData
  };

  const result = createSuccessResponse(data, resultText, 'complete_task');

  await logger.logToolRequest('complete_task', args, result);
  return result;
}

/**
 * Fail task handler
 */
export async function handleFailTask(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  // Validate input
  const validated = FailTaskSchema.parse(args);

  const task = service.failTask(validated.id, validated.error);
  
  if (!task) {
    throw new TaskNotFoundError(validated.id);
  }

  await service.forceSave();

  // Check if task is in an active workflow and auto-advance is enabled
  let workflowInfo = '';
  let workflowData: any = null;
  if (validated.autoAdvance !== false) {
    const runId = service.findActiveWorkflowRunForTask(validated.id);
    if (runId) {
      const advanceResult = service.advanceWorkflowRun(runId);
      if (advanceResult) {
        // Build workflow advancement info
        workflowInfo = '\n\n🔄 **Workflow Auto-Advanced**\n\n';
        workflowInfo += `**Run ID:** ${runId}\n`;
        workflowInfo += `**Workflow Status:** ${advanceResult.workflowStatus}\n`;
        workflowInfo += `**Summary:** ${advanceResult.message}\n\n`;
        
        if (advanceResult.newlyReadyTasks.length > 0) {
          workflowInfo += `**New Ready Tasks (${advanceResult.newlyReadyTasks.length}):**\n`;
          advanceResult.newlyReadyTasks.forEach(t => {
            workflowInfo += `  - ${t.name} (ID: ${t.id})\n`;
          });
        }
        
        if (advanceResult.failedTasks.length > 0) {
          workflowInfo += `\n**Failed Tasks (${advanceResult.failedTasks.length}):**\n`;
          advanceResult.failedTasks.forEach(t => {
            workflowInfo += `  - ${t.name} (ID: ${t.id}) - Error: ${t.error}\n`;
          });
        }
        
        if (advanceResult.workflowStatus === 'completed') {
          workflowInfo += `\n✅ Workflow completed successfully!`;
        } else if (advanceResult.workflowStatus === 'failed') {
          workflowInfo += `\n❌ Workflow failed.`;
        }
        
        workflowData = {
          runId,
          workflowStatus: advanceResult.workflowStatus,
          newlyReadyTasks: advanceResult.newlyReadyTasks.map(t => ({ id: t.id, name: t.name })),
          failedTasks: advanceResult.failedTasks.map(t => ({ id: t.id, name: t.name, error: t.error }))
        };
        
        await service.forceSave();
      }
    }
  }

  let resultText = `❌ Task marked as failed\n\n**Name:** ${task.name}\n**ID:** ${task.id}\n**Error:** ${task.error}\n**Failed At:** ${task.completedAt}`;
  resultText += workflowInfo;

  const data = {
    task: {
      id: task.id,
      name: task.name,
      status: task.status,
      error: task.error,
      completedAt: task.completedAt
    },
    workflow: workflowData
  };

  const result = createSuccessResponse(data, resultText, 'fail_task');

  await logger.logToolRequest('fail_task', args, result);
  return result;
}

/**
 * Start task handler
 */
export async function handleStartTask(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  // Validate input
  const validated = StartTaskSchema.parse(args);

  // Check if task can be executed first to provide better error messages
  const canExecute = service.canExecuteTask(validated.id);
  if (!canExecute.canExecute) {
    throw new TaskExecutionError(validated.id, canExecute.reason || ERROR_MESSAGES.DEPENDENCY_NOT_MET);
  }

  const task = service.markTaskInProgress(validated.id);

  if (!task) {
    throw new TaskExecutionError(validated.id, ERROR_MESSAGES.DEPENDENCY_NOT_MET);
  }

  await service.forceSave();

  const displayOutput = `✅ Task started successfully\n\n**Name:** ${task.name}\n**ID:** ${task.id}\n**Status:** ${task.status}\n**Started At:** ${task.startedAt}`;
  const data = {
    task: {
      id: task.id,
      name: task.name,
      status: task.status,
      startedAt: task.startedAt
    }
  };

  const result = createSuccessResponse(data, displayOutput, 'start_task');

  await logger.logToolRequest('start_task', args, result);
  return result;
}

/**
 * Reset task handler
 */
export async function handleResetTask(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  // Validate input
  const validated = ResetTaskSchema.parse(args);

  const task = service.resetTask(validated.id);
  
  if (!task) {
    throw new TaskNotFoundError(validated.id);
  }

  await service.forceSave();

  const displayOutput = `🔄 Task reset successfully\n\n**Name:** ${task.name}\n**ID:** ${task.id}\n**Status:** ${task.status}\n**Reset At:** ${task.updatedAt}`;
  const data = {
    task: {
      id: task.id,
      name: task.name,
      status: task.status,
      updatedAt: task.updatedAt
    }
  };

  const result = createSuccessResponse(data, displayOutput, 'reset_task');

  await logger.logToolRequest('reset_task', args, result);
  return result;
}

/**
 * Retry task handler
 */
export async function handleRetryTask(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  // Validate input
  const validated = RetryTaskSchema.parse(args);

  const task = service.retryTask(validated.id);
  
  if (!task) {
    throw new TaskNotFoundError(validated.id);
  }

  await service.forceSave();

  const displayOutput = `🔄 Task retried successfully\n\n**Name:** ${task.name}\n**ID:** ${task.id}\n**Retry Count:** ${task.retries}/${task.maxRetries || '∞'}\n**Status:** ${task.status}`;
  const data = {
    task: {
      id: task.id,
      name: task.name,
      status: task.status,
      retries: task.retries,
      maxRetries: task.maxRetries
    }
  };

  const result = createSuccessResponse(data, displayOutput, 'retry_task');

  await logger.logToolRequest('retry_task', args, result);
  return result;
}

/**
 * Get next tasks handler
 */
export async function handleGetNextTasks(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  const tasks = service.getNextExecutableTasks();

  const displayOutput = `📋 Ready to Execute - ${tasks.length} tasks\n\n${tasks.length > 0 
    ? tasks.map(t => `- **${t.name}** (ID: ${t.id})`).join('\n')
    : 'No tasks ready to execute'}`;
  const data = {
    count: tasks.length,
    tasks: tasks.map(t => ({ id: t.id, name: t.name, status: t.status }))
  };

  const result = createSuccessResponse(data, displayOutput, 'get_next_tasks');

  await logger.logToolRequest('get_next_tasks', args, result);
  return result;
}

/**
 * Can execute handler
 */
export async function handleCanExecute(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  // Validate input
  const validated = CanExecuteSchema.parse(args);

  const check = service.canExecuteTask(validated.id);

  const displayOutput = `${check.canExecute ? '✅' : '❌'} Task ${check.canExecute ? 'can' : 'cannot'} be executed\n\n**Task ID:** ${validated.id}\n**Can Execute:** ${check.canExecute}\n${check.reason ? `**Reason:** ${check.reason}` : ''}`;
  const data = {
    taskId: validated.id,
    canExecute: check.canExecute,
    reason: check.reason,
    readinessScore: check.readinessScore,
    readinessBreakdown: check.readinessBreakdown
  };

  const result = createSuccessResponse(data, displayOutput, 'can_execute');

  await logger.logToolRequest('can_execute', args, result);
  return result;
}

/**
 * Create workflow handler
 */
export async function handleCreateWorkflow(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  // Validate input
  const validated = CreateWorkflowSchema.parse(args);

  const workflow = service.createWorkflow(validated.name, validated.taskIds);

  // Attach to strategy if provided
  if (validated.strategyId) {
    const strategy = service.resolveStrategyIdentifier(validated.strategyId);
    if (strategy) {
      workflow.strategyId = strategy.id;
      await service.forceSave();
    }
  }

  await service.forceSave();

  const strategyInfo = workflow.strategyId
    ? `\n**Strategy ID:** ${workflow.strategyId}`
    : '';

  const displayOutput = `✅ Workflow created successfully\n\n**Name:** ${validated.name}\n**Workflow ID:** ${workflow.id}\n**Tasks:** ${validated.taskIds.length}\n**Task IDs:** ${validated.taskIds.join(', ')}${strategyInfo}`;
  const data = {
    workflow: {
      id: workflow.id,
      name: validated.name,
      taskIds: validated.taskIds,
      strategyId: workflow.strategyId
    }
  };

  const result = createSuccessResponse(data, displayOutput, 'create_workflow');

  await logger.logToolRequest('create_workflow', args, result);
  return result;
}

/**
 * Get workflow handler
 */
export async function handleGetWorkflow(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  // Validate input
  const validated = WorkflowIdSchema.parse(args.id);

  const workflow = service.getWorkflow(validated);
  
  if (!workflow) {
    throw new WorkflowNotFoundError(validated);
  }

  const tasks = workflow.taskIds.map(taskId => service.getTask(taskId)).filter((t): t is Task => t !== undefined);

  const displayOutput = `📋 Workflow Details\n\n**Workflow ID:** ${validated}\n**Name:** ${workflow.name}\n**Tasks:** ${workflow.taskIds.length}\n**Task IDs:** ${workflow.taskIds.join(', ')}\n\n${tasks.length > 0 
    ? '**Tasks in workflow:\n' + tasks.map(t => `- **${t.name}** (${t.status})`).join('\n')
    : 'No tasks found'}`;
  const data = {
    workflow: {
      id: validated,
      name: workflow.name,
      taskIds: workflow.taskIds,
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt
    },
    tasks: tasks.map(t => ({ id: t.id, name: t.name, status: t.status }))
  };

  const result = createSuccessResponse(data, displayOutput, 'get_workflow');

  await logger.logToolRequest('get_workflow', args, result);
  return result;
}

/**
 * Get subtasks handler
 */
export async function handleGetSubtasks(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  // Validate input
  const validated = TaskIdSchema.parse(args.id);

  const subtasks = service.getSubtasks(validated);

  const displayOutput = `📋 Subtasks for ${validated} - ${subtasks.length} subtasks\n\n${subtasks.length > 0 
    ? subtasks.map(t => `- **${t.name}** (${t.status}) - ID: ${t.id}`).join('\n')
    : 'No subtasks found'}`;
  const data = {
    parentTaskId: validated,
    count: subtasks.length,
    subtasks: subtasks.map(t => ({ id: t.id, name: t.name, status: t.status }))
  };

  const result = createSuccessResponse(data, displayOutput, 'get_subtasks');

  await logger.logToolRequest('get_subtasks', args, result);
  return result;
}

/**
 * List workflows handler
 */
export async function handleListWorkflows(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  const workflows = service.getAllWorkflows();

  const displayOutput = `📋 All Workflows - ${Object.keys(workflows).length} workflows\n\n${Object.entries(workflows).map(([id, workflow]) => 
    `- **Workflow ID:** ${id}\n  **Name:** ${(workflow as any).name}\n  **Tasks:** ${(workflow as any).taskIds.length}`
  ).join('\n')}`;
  const data = {
    count: Object.keys(workflows).length,
    workflows: Object.entries(workflows).map(([id, workflow]) => ({
      id,
      name: (workflow as any).name,
      taskIds: (workflow as any).taskIds
    }))
  };

  const result = createSuccessResponse(data, displayOutput, 'list_workflows');

  await logger.logToolRequest('list_workflows', args, result);
  return result;
}

/**
 * Delete workflow handler
 */
export async function handleDeleteWorkflow(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  // Validate input
  const validated = WorkflowIdSchema.parse(args.id);

  const deleted = service.deleteWorkflow(validated);
  
  if (!deleted) {
    throw new WorkflowNotFoundError(validated);
  }

  await service.forceSave();

  const displayOutput = `✅ Workflow deleted successfully\n\n**Deleted Workflow ID:** ${validated}`;
  const data = { deletedWorkflowId: validated };

  const result = createSuccessResponse(data, displayOutput, 'delete_workflow');

  await logger.logToolRequest('delete_workflow', args, result);
  return result;
}

/**
 * Get stats handler
 */
export async function handleGetStats(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  const stats = service.getStats();

  const result = {
    content: [
      {
        type: 'text',
        text: `📊 Task & Workflow Statistics\n\n**Total Tasks:** ${stats.totalTasks}\n**Pending:** ${stats.pending}\n**In Progress:** ${stats.inProgress}\n**Completed:** ${stats.completed}\n**Failed:** ${stats.failed}\n**Total Workflows:** ${stats.totalWorkflows}`
      }
    ]
  };

  await logger.logToolRequest('get_stats', args, result);
  return result;
}

/**
 * Clear all handler
 */
export async function handleClearAll(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  await service.clearAll();
  await service.forceSave();

  const displayOutput = '🗑️ All tasks and workflows cleared';
  const data = { cleared: true };

  const result = createSuccessResponse(data, displayOutput, 'clear_all');

  await logger.logToolRequest('clear_all', args, result);
  return result;
}

/**
 * Save state handler
 */
export async function handleSaveState(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  await service.save();

  const displayOutput = '💾 State saved successfully';
  const data = { saved: true };

  const result = createSuccessResponse(data, displayOutput, 'save_state');

  await logger.logToolRequest('save_state', args, result);
  return result;
}

/**
 * Cleanup workflow runs handler
 */
export async function handleCleanupWorkflowRuns(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  const validated = CleanupWorkflowRunsSchema.parse(args);

  const deletedCount = service.cleanupWorkflowRuns({
    maxAgeMs: validated.maxAgeMs,
    maxCount: validated.maxCount
  });

  const displayOutput = `🧹 Cleaned up ${deletedCount} workflow run(s)\n\n**Max Age:** ${validated.maxAgeMs ? `${validated.maxAgeMs}ms` : 'N/A'}\n**Max Count:** ${validated.maxCount || 'N/A'}\n**Deleted:** ${deletedCount}`;
  const data = {
    deletedCount,
    maxAgeMs: validated.maxAgeMs,
    maxCount: validated.maxCount
  };

  const result = createSuccessResponse(data, displayOutput, 'cleanup_workflow_runs');

  await logger.logToolRequest('cleanup_workflow_runs', args, result);
  return result;
}

/**
 * Cleanup tasks handler
 */
export async function handleCleanupTasks(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  const validated = CleanupTasksSchema.parse(args);

  const cleanupResult = service.cleanupTasks({
    deleteOrphans: validated.deleteOrphans,
    deleteParentCompleted: validated.deleteParentCompleted,
    deleteDuplicates: validated.deleteDuplicates,
    deleteStalePending: validated.deleteStalePending,
    stalePendingMs: validated.stalePendingMs
  });

  let detailsText = '';
  if (cleanupResult.details.length > 0) {
    detailsText = `\n\n**Deleted Tasks (${cleanupResult.details.length}):**\n${cleanupResult.details.map(d => `  - ${d.name} (ID: ${d.id}) - ${d.reason}`).join('\n')}`;
  }

  const displayOutput = `🧹 Task cleanup complete\n\n**Deleted:** ${cleanupResult.deleted}\n**Orphaned subtasks found:** ${cleanupResult.orphanedSubtasks}\n**Parent-completed subtasks found:** ${cleanupResult.parentCompleted}\n**Duplicate tasks found:** ${cleanupResult.duplicateTasks}\n**Stale pending tasks found:** ${cleanupResult.stalePendingTasks}${detailsText}`;
  const data = {
    deleted: cleanupResult.deleted,
    orphanedSubtasks: cleanupResult.orphanedSubtasks,
    parentCompleted: cleanupResult.parentCompleted,
    duplicateTasks: cleanupResult.duplicateTasks,
    stalePendingTasks: cleanupResult.stalePendingTasks,
    details: cleanupResult.details
  };

  const result = createSuccessResponse(data, displayOutput, 'cleanup_tasks');

  await logger.logToolRequest('cleanup_tasks', args, result);
  return result;
}

/**
 * Get version handler
 */
export async function handleGetVersion(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { logger } = context;

  const displayOutput = `🔧 Sequential MCP Server\n\n**Name:** sequential\n**Version:** 1.1.1\n**Description:** Sequential task execution MCP server with dependency management and workflow support\n**Features:** task_management, dependency_tracking, workflow_support, persistent_storage, execution_tracking, retry_logic, workflow_execution`;
  const data = {
    name: 'sequential',
    version: '1.1.1',
    description: 'Sequential task execution MCP server with dependency management and workflow support',
    features: ['task_management', 'dependency_tracking', 'workflow_support', 'persistent_storage', 'execution_tracking', 'retry_logic', 'workflow_execution']
  };

  const result = createSuccessResponse(data, displayOutput, 'get_version');

  await logger.logToolRequest('get_version', args, result);
  return result;
}

/**
 * Start workflow execution handler
 */
export async function handleStartWorkflowExecution(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  // Validate input
  const validated = StartWorkflowExecutionSchema.parse(args);

  const result = service.startWorkflowExecution(validated.workflowId);
  
  if (!result) {
    throw new WorkflowNotFoundError(validated.workflowId);
  }

  await service.forceSave();

  const displayOutput = `🚀 Workflow execution started\n\n**Run ID:** ${result.runId}\n**Workflow ID:** ${validated.workflowId}\n**Ready Tasks:** ${result.readyTasks.length}\n**Ready Task Names:** ${result.readyTasks.map(t => t.name).join(', ')}\n\n**Next Steps:**\n1. Work on the ${result.readyTasks.length} ready task(s) listed above\n2. Call complete_task (or fail_task if work fails) for each completed task\n3. Call advance_workflow_run(runId: "${result.runId}") to progress the workflow\n4. Repeat steps 1-3 until the workflow completes\n\n**Important:** Use the runId "${result.runId}" for all subsequent advance_workflow_run calls.`;

  const data = {
    runId: result.runId,
    workflowId: validated.workflowId,
    readyTasks: result.readyTasks.map(t => ({ id: t.id, name: t.name }))
  };

  const response = createSuccessResponse(data, displayOutput, 'start_workflow_execution');

  await logger.logToolRequest('start_workflow_execution', args, response);
  return response;
}

/**
 * Advance workflow run handler
 */
export async function handleAdvanceWorkflowRun(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  // Validate input
  const validated = AdvanceWorkflowRunSchema.parse(args);

  const result = service.advanceWorkflowRun(validated.runId);
  
  if (!result) {
    throw new WorkflowNotFoundError(validated.runId);
  }

  await service.forceSave();

  // Build detailed output
  let output = `➡️ Workflow run advanced\n\n**Run ID:** ${result.run.id}\n**Status:** ${result.workflowStatus}\n\n`;
  output += `**Summary:** ${result.message}\n\n`;
  
  if (result.completedTasks.length > 0) {
    output += `**Completed Tasks (${result.completedTasks.length}):**\n`;
    result.completedTasks.forEach(t => {
      output += `  - ${t.name} (ID: ${t.id})\n`;
    });
    output += '\n';
  }
  
  if (result.failedTasks.length > 0) {
    output += `**Failed Tasks (${result.failedTasks.length}):**\n`;
    result.failedTasks.forEach(t => {
      output += `  - ${t.name} (ID: ${t.id}) - Error: ${t.error}\n`;
    });
    output += '\n';
  }
  
  if (result.newlyReadyTasks.length > 0) {
    output += `**New Ready Tasks (${result.newlyReadyTasks.length}):**\n`;
    result.newlyReadyTasks.forEach(t => {
      output += `  - ${t.name} (ID: ${t.id})\n`;
    });
    output += '\n';
  }
  
  if (result.blockedTasks.length > 0) {
    output += `**Blocked Tasks (${result.blockedTasks.length}):**\n`;
    result.blockedTasks.forEach(t => {
      output += `  - ${t.name} (ID: ${t.id}) - Status: ${t.status}\n`;
    });
  }

  // Add actionable next steps
  if (result.workflowStatus === 'in_progress') {
    if (result.newlyReadyTasks.length > 0) {
      output += `\n**Next Steps:**\n1. Work on the ${result.newlyReadyTasks.length} newly ready task(s) listed above\n2. Call complete_task (or fail_task if work fails) for each completed task\n3. Call advance_workflow_run(runId: "${result.run.id}") again to progress the workflow\n4. Repeat until the workflow completes\n`;
    } else {
      output += `\n**Next Steps:**\nNo new tasks are ready yet. This may mean:\n- Some tasks are still in progress\n- Tasks are blocked by dependencies\n- Check blocked tasks list above for details\n\nContinue working on in-progress tasks, then call advance_workflow_run again.\n`;
    }
  } else if (result.workflowStatus === 'completed') {
    output += `\n✅ Workflow completed successfully! All tasks have been finished.\n`;
  } else if (result.workflowStatus === 'failed') {
    output += `\n❌ Workflow failed. See failed tasks above for details.\n`;
  }

  const data = {
    runId: result.run.id,
    workflowStatus: result.workflowStatus,
    summary: result.message,
    completedTasks: result.completedTasks.map(t => ({ id: t.id, name: t.name })),
    failedTasks: result.failedTasks.map(t => ({ id: t.id, name: t.name, error: t.error })),
    newlyReadyTasks: result.newlyReadyTasks.map(t => ({ id: t.id, name: t.name })),
    blockedTasks: result.blockedTasks.map(t => ({ id: t.id, name: t.name, status: t.status }))
  };

  const response = createSuccessResponse(data, output, 'advance_workflow_run');

  await logger.logToolRequest('advance_workflow_run', args, response);
  return response;
}

/**
 * Get workflow run handler
 */
export async function handleGetWorkflowRun(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  // Validate input
  const validated = GetWorkflowRunSchema.parse(args);

  const run = service.getWorkflowRun(validated.runId);
  
  if (!run) {
    throw new WorkflowNotFoundError(validated.runId);
  }

  const displayOutput = `📋 Workflow Run Details\n\n**Run ID:** ${run.id}\n**Workflow ID:** ${run.workflowId}\n**Status:** ${run.status}\n**Completed Tasks:** ${run.completedTaskIds.length}\n**Active Tasks:** ${run.activeTaskIds.length}\n**Blocked Tasks:** ${run.blockedTaskIds.length}\n**Started:** ${run.startedAt}\n${run.completedAt ? `**Completed:** ${run.completedAt}` : ''}\n${run.error ? `**Error:** ${run.error}` : ''}`;
  const data = {
    run: {
      id: run.id,
      workflowId: run.workflowId,
      status: run.status,
      completedTaskIds: run.completedTaskIds,
      activeTaskIds: run.activeTaskIds,
      blockedTaskIds: run.blockedTaskIds,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      error: run.error
    }
  };

  const result = createSuccessResponse(data, displayOutput, 'get_workflow_run');

  await logger.logToolRequest('get_workflow_run', args, result);
  return result;
}

/**
 * List workflow runs handler
 */
export async function handleListWorkflowRuns(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  const runs = service.getAllWorkflowRuns();

  const displayOutput = `📋 All Workflow Runs - ${runs.length} runs\n\n${runs.map(r => 
    `- **Run ID:** ${r.id} (${r.status}) - Workflow: ${r.workflowId}`
  ).join('\n')}`;
  const data = {
    count: runs.length,
    runs: runs.map(r => ({
      id: r.id,
      workflowId: r.workflowId,
      status: r.status,
      startedAt: r.startedAt,
      completedAt: r.completedAt
    }))
  };

  const result = createSuccessResponse(data, displayOutput, 'list_workflow_runs');

  await logger.logToolRequest('list_workflow_runs', args, result);
  return result;
}

/**
 * Get next workflow tasks handler
 */
export async function handleGetNextWorkflowTasks(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  // Validate input
  const validated = GetNextWorkflowTasksSchema.parse(args);

  const tasks = service.getNextWorkflowTasks(validated.workflowId);

  const displayOutput = `📋 Ready Tasks in Workflow - ${tasks.length} tasks\n\n**Workflow ID:** ${validated.workflowId}\n**Ready Tasks:** ${tasks.length}\n**Ready Task Names:** ${tasks.map(t => t.name).join(', ')}\n\n${tasks.length > 0 
    ? '**Tasks:\n' + tasks.map(t => `- **${t.name}** (ID: ${t.id})`).join('\n')
    : 'No tasks ready to execute'}`;
  const data = {
    workflowId: validated.workflowId,
    count: tasks.length,
    tasks: tasks.map(t => ({ id: t.id, name: t.name, status: t.status }))
  };

  const result = createSuccessResponse(data, displayOutput, 'get_next_workflow_tasks');

  await logger.logToolRequest('get_next_workflow_tasks', args, result);
  return result;
}

/**
 * Add dependency handler
 */
export async function handleAddDependency(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  const validated = AddDependencySchema.parse(args);

  const task = service.addDependency(validated.taskId, validated.dependency);

  if (!task) {
    throw new TaskNotFoundError(validated.taskId);
  }

  await service.forceSave();

  const displayOutput = `✅ Dependency added successfully\n\n**Task ID:** ${validated.taskId}\n**Task Name:** ${task.name}\n**Dependencies:** ${task.dependencies.length}`;
  const data = {
    taskId: validated.taskId,
    taskName: task.name,
    dependencyCount: task.dependencies.length
  };

  const result = createSuccessResponse(data, displayOutput, 'add_dependency');

  await logger.logToolRequest('add_dependency', args, result);
  return result;
}

/**
 * Remove dependency handler
 */
export async function handleRemoveDependency(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  const validated = RemoveDependencySchema.parse(args);

  const task = service.removeDependency(validated.taskId, validated.depTaskId);

  if (!task) {
    throw new TaskNotFoundError(validated.taskId);
  }

  await service.forceSave();

  const result = {
    content: [
      {
        type: 'text',
        text: `✅ Dependency removed successfully\n\n**Task ID:** ${validated.taskId}\n**Task Name:** ${task.name}\n**Removed Dependency:** ${validated.depTaskId}\n**Remaining Dependencies:** ${task.dependencies.length}`
      }
    ]
  };

  await logger.logToolRequest('remove_dependency', args, result);
  return result;
}

/**
 * Update dependency handler
 */
export async function handleUpdateDependency(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  const validated = UpdateDependencySchema.parse(args);

  const task = service.updateDependency(validated.taskId, validated.depTaskId, validated.updates || {});

  if (!task) {
    throw new TaskNotFoundError(validated.taskId);
  }

  await service.forceSave();

  const displayOutput = `✅ Dependency updated successfully\n\n**Task ID:** ${validated.taskId}\n**Task Name:** ${task.name}\n**Updated Dependency:** ${validated.depTaskId}`;
  const data = {
    taskId: validated.taskId,
    taskName: task.name,
    updatedDependencyId: validated.depTaskId,
    updates: validated.updates
  };

  const result = createSuccessResponse(data, displayOutput, 'update_dependency');

  await logger.logToolRequest('update_dependency', args, result);
  return result;
}

/**
 * Move task handler
 */
export async function handleMoveTask(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  const validated = MoveTaskSchema.parse(args);

  const task = service.moveTask(validated.taskId, validated.newParentTaskId ?? null, validated.position);

  if (!task) {
    throw new TaskNotFoundError(validated.taskId);
  }

  await service.forceSave();

  const displayOutput = `✅ Task moved successfully\n\n**Task ID:** ${validated.taskId}\n**Task Name:** ${task.name}\n**New Parent:** ${validated.newParentTaskId || 'None'}\n**Position:** ${validated.position ?? 'Default'}`;
  const data = {
    taskId: validated.taskId,
    taskName: task.name,
    newParentTaskId: validated.newParentTaskId,
    position: validated.position
  };

  const result = createSuccessResponse(data, displayOutput, 'move_task');

  await logger.logToolRequest('move_task', args, result);
  return result;
}

/**
 * Get dependency graph handler
 */
export async function handleGetDependencyGraph(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  const validated = GetDependencyGraphSchema.parse(args);

  const graph = service.getDependencyGraph(validated.workflowId);

  const nodesText = graph.nodes.map(n => `  - ${n.name} (${n.id}) [${n.status}]`).join('\n');
  const edgesText = graph.edges.map(e => `  - ${e.from} → ${e.to} (${e.type})`).join('\n');

  const displayOutput = `📊 Dependency Graph\n\n**Nodes (${graph.nodes.length}):**\n${nodesText}\n\n**Edges (${graph.edges.length}):**\n${edgesText}`;
  const data = {
    workflowId: validated.workflowId,
    nodes: graph.nodes.map(n => ({ id: n.id, name: n.name, status: n.status })),
    edges: graph.edges.map(e => ({ from: e.from, to: e.to, type: e.type }))
  };

  const result = createSuccessResponse(data, displayOutput, 'get_dependency_graph');

  await logger.logToolRequest('get_dependency_graph', args, result);
  return result;
}

/**
 * Visualize as ASCII tree handler
 */
export async function handleVisualizeAscii(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  const validated = VisualizeAsciiSchema.parse(args);

  const asciiTree = service.renderAsciiTree(validated.workflowId);

  const displayOutput = `📊 ASCII Tree Visualization\n\n\`\`\`\n${asciiTree}\n\`\`\``;
  const data = {
    workflowId: validated.workflowId,
    asciiTree
  };

  const result = createSuccessResponse(data, displayOutput, 'visualize_ascii');

  await logger.logToolRequest('visualize_ascii', args, result);
  return result;
}

/**
 * Export Mermaid handler
 */
export async function handleExportMermaid(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> }> {
  const { service, logger } = context;

  const validated = ExportMermaidSchema.parse(args);

  const mermaid = service.exportMermaid(validated.workflowId);

  // Generate default filename if not provided
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const workflowId = validated.workflowId ? `${validated.workflowId}-` : '';
  const filename = validated.filename || `workflow-${workflowId}${timestamp}.${validated.format}`;
  const filePath = path.resolve(filename);

  // If format is mmd, save as text file and use new JSON response format
  if (validated.format === 'mmd') {
    await fs.writeFile(filePath, mermaid, 'utf-8');
    
    const displayOutput = `📊 Mermaid diagram saved to: ${filePath}\n\n\`\`\`mermaid\n${mermaid}\n\`\`\``;
    const data = {
      filePath,
      format: 'mmd',
      mermaid
    };

    const result = createSuccessResponse(data, displayOutput, 'export_mermaid');

    await logger.logToolRequest('export_mermaid', args, result);
    return result;
  }

  // Render to PNG or SVG and return as image
  try {
    const rendered = await renderMermaid(mermaid, validated.format);
    
    // Decode base64 and save to file
    const buffer = Buffer.from(rendered.data, 'base64');
    await fs.writeFile(filePath, buffer);
    
    // Return image response for image formats
    const mimeType = validated.format === 'png' ? 'image/png' : 'image/svg+xml';
    const result = {
      content: [
        {
          type: 'image',
          data: rendered.data,
          mimeType
        },
        {
          type: 'text',
          text: `📊 Mermaid diagram saved to: ${filePath}`
        }
      ]
    };

    await logger.logToolRequest('export_mermaid', args, result);
    return result;
  } catch (error) {
    throw new Error(`Failed to render Mermaid diagram: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Export graph image handler (dedicated tool for image export)
 */
export async function handleExportGraphImage(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> }> {
  const { service, logger } = context;

  const validated = ExportGraphImageSchema.parse(args);

  const mermaid = service.exportMermaid(validated.workflowId);

  // Generate default filename if not provided
  const filename = validated.filename || `workflow-graph.${validated.format}`;
  const filePath = path.resolve(filename);

  try {
    const rendered = await renderMermaid(mermaid, validated.format);
    
    // Decode base64 and save to file
    const buffer = Buffer.from(rendered.data, 'base64');
    await fs.writeFile(filePath, buffer);
    
    // Return image response
    const mimeType = validated.format === 'png' ? 'image/png' : 'image/svg+xml';
    const result = {
      content: [
        {
          type: 'image',
          data: rendered.data,
          mimeType
        },
        {
          type: 'text',
          text: `📊 Graph image saved to: ${filePath}`
        }
      ]
    };

    await logger.logToolRequest('export_graph_image', args, result);
    return result;
  } catch (error) {
    throw new Error(`Failed to render graph image: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Export strategy as Mermaid diagram handler
 */
export async function handleExportStrategyMermaid(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> }> {
  const { service, logger } = context;

  const validated = ExportStrategyMermaidSchema.parse(args);

  const mermaid = service.exportStrategyMermaid(validated.strategyId);

  // Generate default filename if not provided
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const strategyId = validated.strategyId.replace(/[^a-zA-Z0-9-]/g, '-');
  const filename = validated.filename || `strategy-${strategyId}-${timestamp}.${validated.format}`;
  const filePath = path.resolve(filename);

  // If format is mmd, save as text file and use new JSON response format
  if (validated.format === 'mmd') {
    await fs.writeFile(filePath, mermaid, 'utf-8');
    
    const displayOutput = `📊 Strategy Mermaid diagram saved to: ${filePath}\n\n\`\`\`mermaid\n${mermaid}\n\`\`\``;
    const data = {
      filePath,
      format: 'mmd',
      mermaid
    };

    const result = createSuccessResponse(data, displayOutput, 'export_strategy_mermaid');

    await logger.logToolRequest('export_strategy_mermaid', args, result);
    return result;
  }

  // Render to PNG or SVG and return as image
  try {
    const rendered = await renderMermaid(mermaid, validated.format);
    
    // Decode base64 and save to file
    const buffer = Buffer.from(rendered.data, 'base64');
    await fs.writeFile(filePath, buffer);
    
    // Return image response for image formats
    const mimeType = validated.format === 'png' ? 'image/png' : 'image/svg+xml';
    const result = {
      content: [
        {
          type: 'image',
          data: rendered.data,
          mimeType
        },
        {
          type: 'text',
          text: `📊 Strategy Mermaid diagram saved to: ${filePath}`
        }
      ]
    };

    await logger.logToolRequest('export_strategy_mermaid', args, result);
    return result;
  } catch (error) {
    throw new Error(`Failed to render strategy Mermaid diagram: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get blocked tasks handler
 */
export async function handleGetBlockedTasks(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  const validated = GetBlockedTasksSchema.parse(args);

  const blockedTasks = service.getBlockedTasks(validated.workflowId);

  const tasksText = blockedTasks.map(bt => {
    const depsText = bt.blockingDeps.map(d => `    - ${d}`).join('\n');
    return `  - **${bt.task.name}** (${bt.task.id})\n    **Blocking Dependencies:**\n${depsText}`;
  }).join('\n');

  const displayOutput = `🚫 Blocked Tasks - ${blockedTasks.length} tasks\n\n${blockedTasks.length > 0 ? tasksText : 'No blocked tasks'}`;
  const data = {
    workflowId: validated.workflowId,
    count: blockedTasks.length,
    blockedTasks: blockedTasks.map(bt => ({
      taskId: bt.task.id,
      taskName: bt.task.name,
      blockingDeps: bt.blockingDeps
    }))
  };

  const result = createSuccessResponse(data, displayOutput, 'get_blocked_tasks');

  await logger.logToolRequest('get_blocked_tasks', args, result);
  return result;
}

/**
 * Get critical path handler
 */
export async function handleGetCriticalPath(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  const validated = GetCriticalPathSchema.parse(args);

  const criticalPath = service.getCriticalPath(validated.workflowId);

  const pathText = criticalPath.map(taskId => {
    const task = service.getTask(taskId);
    return task ? `  - ${task.name} (${task.id})` : `  - ${taskId} (not found)`;
  }).join('\n');

  const displayOutput = `🛤️ Critical Path - ${criticalPath.length} tasks\n\n**Workflow ID:** ${validated.workflowId}\n**Path Length:** ${criticalPath.length}\n\n**Critical Path:**\n${pathText}`;
  const data = {
    workflowId: validated.workflowId,
    pathLength: criticalPath.length,
    criticalPath: criticalPath.map(taskId => {
      const task = service.getTask(taskId);
      return task ? { id: taskId, name: task.name } : { id: taskId, name: 'not found' };
    })
  };

  const result = createSuccessResponse(data, displayOutput, 'get_critical_path');

  await logger.logToolRequest('get_critical_path', args, result);
  return result;
}

/**
 * Export workflow bundle handler
 */
export async function handleExportWorkflowBundle(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  const validated = ExportWorkflowBundleSchema.parse(args);

  const bundle = service.exportWorkflowBundle(validated.workflowId, {
    includeRuns: validated.includeRuns,
    humanReadableOnly: validated.humanReadableOnly
  });

  // Save to file if filePath is provided
  let fileSavedMessage = '';
  if (validated.filePath) {
    try {
      const fs = await import('fs/promises');
      await fs.writeFile(validated.filePath, JSON.stringify(bundle, null, 2), 'utf-8');
      fileSavedMessage = `\n**File Saved:** ${validated.filePath}`;
    } catch (error) {
      fileSavedMessage = `\n**Error saving file:** ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  // Build name map summary for display
  const nameMapSummary = bundle.nameToIdMap 
    ? `\n**Name Map (sample):**\n${Object.entries(bundle.nameToIdMap).slice(0, 5).map(([name, id]) => `  ${name} → ${id}`).join('\n')}${Object.keys(bundle.nameToIdMap).length > 5 ? '\n  ...' : ''}`
    : '';

  const bundleJson = validated.filePath 
    ? '(Bundle saved to file - use import_workflow_bundle to restore)'
    : JSON.stringify(bundle, null, 2);

  const displayOutput = `📦 Workflow Bundle Exported Successfully\n\n**Workflow Name:** ${bundle.templateName || bundle.workflow.name}\n**Bundle Version:** ${bundle.version}\n**Exported At:** ${bundle.exportedAt}\n**Tasks Included:** ${bundle.tasks.length}\n**Tags:** ${bundle.tags?.join(', ') || 'None'}\n**Human Readable Only:** ${bundle.humanReadableOnly ? 'Yes' : 'No'}${nameMapSummary}${fileSavedMessage}\n\n**Full Bundle (JSON):**\n\`\`\`json\n${bundleJson}\n\`\`\`\n\n**Usage:**\n${validated.filePath ? `File saved to ${validated.filePath}. Use import_workflow_bundle to restore it in a new session.` : 'Save this JSON to a file and use import_workflow_bundle to restore it in a new session.'}`;
  const data = {
    workflowName: bundle.templateName || bundle.workflow.name,
    bundleVersion: bundle.version,
    exportedAt: bundle.exportedAt,
    tasksIncluded: bundle.tasks.length,
    tags: bundle.tags,
    humanReadableOnly: bundle.humanReadableOnly,
    filePath: validated.filePath
  };

  const result = createSuccessResponse(data, displayOutput, 'export_workflow_bundle');

  await logger.logToolRequest('export_workflow_bundle', args, result);
  return result;
}

/**
 * Import workflow bundle handler
 */
export async function handleImportWorkflowBundle(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  const validated = ImportWorkflowBundleSchema.parse(args);

  const importResult = service.importWorkflowBundle(validated.bundle, {
    namePrefix: validated.namePrefix,
    deduplication: validated.deduplication,
    nameRemapping: validated.nameRemapping
  });

  const workflow = service.getWorkflow(importResult.newWorkflowId);

  // Build name-aware mapping summary if bundle has name maps
  const mappingSummary = validated.bundle.idToNameMap
    ? Object.entries(importResult.taskIdMap).slice(0, 5).map(([oldId, newId]) => {
        const qualifiedName = validated.bundle.idToNameMap?.[oldId] || oldId;
        return `  ${qualifiedName} → ${newId}`;
      }).join('\n') + (Object.keys(importResult.taskIdMap).length > 5 ? '\n  ...' : '')
    : Object.entries(importResult.taskIdMap).slice(0, 5).map(([oldId, newId]) => `  ${oldId} → ${newId}`).join('\n') + (Object.keys(importResult.taskIdMap).length > 5 ? '\n  ...' : '');

  const displayOutput = `📦 Workflow Bundle Imported Successfully\n\n**New Workflow ID:** ${importResult.newWorkflowId}\n**Workflow Name:** ${workflow?.name || 'Unknown'}\n**Tasks Imported:** ${Object.keys(importResult.taskIdMap).length}\n**Name Prefix:** ${validated.namePrefix || 'None'}\n**Deduplication Strategy:** ${validated.deduplication || 'none'}\n**Name Remapping:** ${validated.nameRemapping ? `${Object.keys(validated.nameRemapping).length} tasks remapped` : 'None'}\n\n**Task ID Mapping (sample):**\n${mappingSummary}\n\n**Next Steps:**\n- Use start_workflow_execution to begin executing the imported workflow\n- Or use list_tasks to see all imported tasks`;
  const data = {
    newWorkflowId: importResult.newWorkflowId,
    workflowName: workflow?.name || 'Unknown',
    tasksImported: Object.keys(importResult.taskIdMap).length,
    namePrefix: validated.namePrefix,
    deduplication: validated.deduplication,
    nameRemapping: validated.nameRemapping ? Object.keys(validated.nameRemapping).length : 0,
    taskIdMap: importResult.taskIdMap
  };

  const result = createSuccessResponse(data, displayOutput, 'import_workflow_bundle');

  await logger.logToolRequest('import_workflow_bundle', args, result);
  return result;
}

// ============================================================================
// STRATEGY HANDLERS
// ============================================================================

/**
 * Create strategy handler
 */
export async function handleCreateStrategy(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  const validated = CreateStrategySchema.parse(args);

  const strategy = service.createStrategy(
    validated.name,
    validated.description,
    validated.tags
  );

  await service.forceSave();

  const displayOutput = `✅ Strategy Created Successfully\n\n**Strategy ID:** ${strategy.id}\n**Name:** ${strategy.name}\n**Description:** ${strategy.description || 'None'}\n**Status:** ${strategy.status}\n**Tags:** ${strategy.tags?.join(', ') || 'None'}`;
  const data = {
    id: strategy.id,
    name: strategy.name,
    description: strategy.description,
    status: strategy.status,
    tags: strategy.tags
  };

  const result = createSuccessResponse(data, displayOutput, 'create_strategy');
  await logger.logToolRequest('create_strategy', args, result);
  return result;
}

/**
 * Get strategy handler
 */
export async function handleGetStrategy(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  const validated = GetStrategySchema.parse(args);

  const strategy = service.resolveStrategyIdentifier(validated.id);
  if (!strategy) {
    throw new StrategyNotFoundError(validated.id);
  }

  const displayOutput = `📋 Strategy Details\n\n**ID:** ${strategy.id}\n**Name:** ${strategy.name}\n**Description:** ${strategy.description || 'None'}\n**Status:** ${strategy.status}\n**Created:** ${strategy.createdAt}\n**Updated:** ${strategy.updatedAt}\n**Tags:** ${strategy.tags?.join(', ') || 'None'}`;
  const data = {
    id: strategy.id,
    name: strategy.name,
    description: strategy.description,
    status: strategy.status,
    createdAt: strategy.createdAt,
    updatedAt: strategy.updatedAt,
    tags: strategy.tags
  };

  const result = createSuccessResponse(data, displayOutput, 'get_strategy');
  await logger.logToolRequest('get_strategy', args, result);
  return result;
}

/**
 * List strategies handler
 */
export async function handleListStrategies(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  const validated = ListStrategiesSchema.parse(args);

  const allStrategies = service.getAllStrategies();
  let strategies = Object.values(allStrategies);

  if (validated.status) {
    strategies = strategies.filter(s => s.status === validated.status);
  }

  if (strategies.length === 0) {
    const displayOutput = `📋 No strategies found${validated.status ? ` with status '${validated.status}'` : ''}`;
    const result = createSuccessResponse({ strategies: [] }, displayOutput, 'list_strategies');
    await logger.logToolRequest('list_strategies', args, result);
    return result;
  }

  const strategySummaries = strategies.map(s =>
    `- **${s.name}** (ID: ${s.id})\n  Status: ${s.status}\n  Description: ${s.description || 'None'}\n  Tags: ${s.tags?.join(', ') || 'None'}`
  ).join('\n\n');

  const displayOutput = `📋 Strategies (${strategies.length})\n\n${strategySummaries}`;
  const data = {
    strategies: strategies.map(s => ({
      id: s.id,
      name: s.name,
      description: s.description,
      status: s.status,
      tags: s.tags
    }))
  };

  const result = createSuccessResponse(data, displayOutput, 'list_strategies');
  await logger.logToolRequest('list_strategies', args, result);
  return result;
}

/**
 * Update strategy handler
 */
export async function handleUpdateStrategy(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  const validated = UpdateStrategySchema.parse(args);

  const strategy = service.updateStrategy(validated.id, {
    name: validated.name,
    description: validated.description,
    status: validated.status,
    tags: validated.tags
  });

  if (!strategy) {
    throw new StrategyNotFoundError(validated.id);
  }

  await service.forceSave();

  const displayOutput = `✅ Strategy Updated Successfully\n\n**ID:** ${strategy.id}\n**Name:** ${strategy.name}\n**Description:** ${strategy.description || 'None'}\n**Status:** ${strategy.status}\n**Tags:** ${strategy.tags?.join(', ') || 'None'}`;
  const data = {
    id: strategy.id,
    name: strategy.name,
    description: strategy.description,
    status: strategy.status,
    tags: strategy.tags
  };

  const result = createSuccessResponse(data, displayOutput, 'update_strategy');
  await logger.logToolRequest('update_strategy', args, result);
  return result;
}

/**
 * Delete strategy handler
 */
export async function handleDeleteStrategy(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  const validated = DeleteStrategySchema.parse(args);

  const strategy = service.getStrategy(validated.id) || service.getStrategyByName(validated.id);
  if (!strategy) {
    throw new StrategyNotFoundError(validated.id);
  }

  const deleted = service.deleteStrategy(strategy.id);

  if (!deleted) {
    throw new StrategyNotFoundError(validated.id);
  }

  await service.forceSave();

  const displayOutput = `✅ Strategy Deleted Successfully\n\n**ID:** ${strategy.id}\n**Name:** ${strategy.name}\n\nNote: Workflows in this strategy have been ungrouped but not deleted.`;
  const data = {
    id: strategy.id,
    name: strategy.name
  };

  const result = createSuccessResponse(data, displayOutput, 'delete_strategy');
  await logger.logToolRequest('delete_strategy', args, result);
  return result;
}

/**
 * Move workflow to strategy handler
 */
export async function handleMoveWorkflowToStrategy(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  const validated = MoveWorkflowToStrategySchema.parse(args);

  const workflow = service.moveWorkflowToStrategy(validated.workflowId, validated.strategyId);

  await service.forceSave();

  const strategy = service.getStrategy(workflow.strategyId!);

  const displayOutput = `✅ Workflow Moved to Strategy\n\n**Workflow ID:** ${workflow.id}\n**Workflow Name:** ${workflow.name}\n**Strategy ID:** ${strategy?.id}\n**Strategy Name:** ${strategy?.name}`;
  const data = {
    workflowId: workflow.id,
    workflowName: workflow.name,
    strategyId: strategy?.id,
    strategyName: strategy?.name
  };

  const result = createSuccessResponse(data, displayOutput, 'move_workflow_to_strategy');
  await logger.logToolRequest('move_workflow_to_strategy', args, result);
  return result;
}

/**
 * Remove workflow from strategy handler
 */
export async function handleRemoveWorkflowFromStrategy(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  const validated = RemoveWorkflowFromStrategySchema.parse(args);

  const workflow = service.removeWorkflowFromStrategy(validated.workflowId);

  await service.forceSave();

  const displayOutput = `✅ Workflow Removed from Strategy\n\n**Workflow ID:** ${workflow.id}\n**Workflow Name:** ${workflow.name}`;
  const data = {
    workflowId: workflow.id,
    workflowName: workflow.name
  };

  const result = createSuccessResponse(data, displayOutput, 'remove_workflow_from_strategy');
  await logger.logToolRequest('remove_workflow_from_strategy', args, result);
  return result;
}

/**
 * Clone workflow to strategy handler
 */
export async function handleCloneWorkflowToStrategy(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  const validated = CloneWorkflowToStrategySchema.parse(args);

  const cloneResult = service.cloneWorkflowToStrategy(
    validated.workflowId,
    validated.strategyId,
    { namePrefix: validated.namePrefix }
  );

  await service.forceSave();

  const strategy = service.getStrategy(cloneResult.workflow.strategyId!);

  const displayOutput = `✅ Workflow Cloned to Strategy\n\n**New Workflow ID:** ${cloneResult.workflow.id}\n**New Workflow Name:** ${cloneResult.workflow.name}\n**Strategy ID:** ${strategy?.id}\n**Strategy Name:** ${strategy?.name}\n**Tasks Cloned:** ${Object.keys(cloneResult.taskIdMap).length}\n**Name Prefix:** ${validated.namePrefix || 'None'}`;
  const data = {
    workflowId: cloneResult.workflow.id,
    workflowName: cloneResult.workflow.name,
    strategyId: strategy?.id,
    strategyName: strategy?.name,
    tasksCloned: Object.keys(cloneResult.taskIdMap).length,
    taskIdMap: cloneResult.taskIdMap
  };

  const result = createSuccessResponse(data, displayOutput, 'clone_workflow_to_strategy');
  await logger.logToolRequest('clone_workflow_to_strategy', args, result);
  return result;
}

/**
 * Get workflows by strategy handler
 */
export async function handleGetWorkflowsByStrategy(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  const validated = GetWorkflowsByStrategySchema.parse(args);

  const strategy = service.resolveStrategyIdentifier(validated.strategyId);
  if (!strategy) {
    throw new StrategyNotFoundError(validated.strategyId);
  }

  const workflows = service.getWorkflowsByStrategy(strategy.id);

  if (workflows.length === 0) {
    const displayOutput = `📋 No workflows found in strategy '${strategy.name}'`;
    const result = createSuccessResponse({ workflows: [] }, displayOutput, 'get_workflows_by_strategy');
    await logger.logToolRequest('get_workflows_by_strategy', args, result);
    return result;
  }

  const workflowSummaries = workflows.map(w =>
    `- **${w.name}** (ID: ${w.id})\n  Tasks: ${w.taskIds.length}\n  Created: ${w.createdAt}`
  ).join('\n\n');

  const displayOutput = `📋 Workflows in Strategy '${strategy.name}' (${workflows.length})\n\n${workflowSummaries}`;
  const data = {
    strategyId: strategy.id,
    strategyName: strategy.name,
    workflows: workflows.map(w => ({
      id: w.id,
      name: w.name,
      taskIds: w.taskIds,
      createdAt: w.createdAt
    }))
  };

  const result = createSuccessResponse(data, displayOutput, 'get_workflows_by_strategy');
  await logger.logToolRequest('get_workflows_by_strategy', args, result);
  return result;
}

/**
 * Handler registry mapping tool names to their handlers
 */
export const handlerRegistry: Record<string, (context: HandlerContext, args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> }>> = {
  create_tasks: handleCreateTasks,
  update_task: handleUpdateTask,
  delete_task: handleDeleteTask,
  get_task: handleGetTask,
  get_subtasks: handleGetSubtasks,
  list_tasks: handleListTasks,
  complete_task: handleCompleteTask,
  fail_task: handleFailTask,
  start_task: handleStartTask,
  reset_task: handleResetTask,
  retry_task: handleRetryTask,
  get_next_tasks: handleGetNextTasks,
  can_execute: handleCanExecute,
  create_workflow: handleCreateWorkflow,
  get_workflow: handleGetWorkflow,
  list_workflows: handleListWorkflows,
  delete_workflow: handleDeleteWorkflow,
  start_workflow_execution: handleStartWorkflowExecution,
  advance_workflow_run: handleAdvanceWorkflowRun,
  get_workflow_run: handleGetWorkflowRun,
  list_workflow_runs: handleListWorkflowRuns,
  get_next_workflow_tasks: handleGetNextWorkflowTasks,
  get_stats: handleGetStats,
  clear_all: handleClearAll,
  save_state: handleSaveState,
  get_version: handleGetVersion,
  cleanup_workflow_runs: handleCleanupWorkflowRuns,
  cleanup_tasks: handleCleanupTasks,
  add_dependency: handleAddDependency,
  remove_dependency: handleRemoveDependency,
  update_dependency: handleUpdateDependency,
  move_task: handleMoveTask,
  get_dependency_graph: handleGetDependencyGraph,
  visualize_ascii: handleVisualizeAscii,
  export_mermaid: handleExportMermaid,
  export_graph_image: handleExportGraphImage,
  export_strategy_mermaid: handleExportStrategyMermaid,
  get_blocked_tasks: handleGetBlockedTasks,
  get_critical_path: handleGetCriticalPath,
  export_workflow_bundle: handleExportWorkflowBundle,
  import_workflow_bundle: handleImportWorkflowBundle,
  create_strategy: handleCreateStrategy,
  get_strategy: handleGetStrategy,
  list_strategies: handleListStrategies,
  update_strategy: handleUpdateStrategy,
  delete_strategy: handleDeleteStrategy,
  move_workflow_to_strategy: handleMoveWorkflowToStrategy,
  remove_workflow_from_strategy: handleRemoveWorkflowFromStrategy,
  clone_workflow_to_strategy: handleCloneWorkflowToStrategy,
  get_workflows_by_strategy: handleGetWorkflowsByStrategy
};
