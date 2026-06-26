import { TaskOrchestratorService } from './taskOrchestratorService.js';
import { getLogger } from './logger.js';
import { 
  ValidationError, 
  TaskNotFoundError, 
  WorkflowNotFoundError,
  TaskExecutionError
} from './errors.js';
import type { Task } from './types.js';
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
  GetBlockedTasksSchema,
  GetCriticalPathSchema
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

  const result = {
    content: [
      {
        type: 'text',
        text: `✅ ${tasks.length} task(s) created successfully\n\n${taskSummaries}`
      }
    ]
  };

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

  const result = {
    content: [
      {
        type: 'text',
        text: `✅ Task updated successfully\n\n**Name:** ${task.name}\n**ID:** ${task.id}\n**Status:** ${task.status}${parentInfo}\n**Updated:** ${task.updatedAt}`
      }
    ]
  };

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

  const result = {
    content: [
      {
        type: 'text',
        text: `✅ Task deleted successfully\n\n**Deleted Task ID:** ${validated}`
      }
    ]
  };

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

  const result = {
    content: [
      {
        type: 'text',
        text: `📋 Task Details\n\n**Name:** ${task.name}\n**ID:** ${task.id}\n**Status:** ${task.status}${parentInfo}${subtaskInfo}\n**Created:** ${task.createdAt}\n**Updated:** ${task.updatedAt}`
      }
    ]
  };

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

  const result = {
    content: [
      {
        type: 'text',
        text: `${completedCount}/${tasks.length} tasks done\n\n${taskList}`
      }
    ]
  };

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

  const result = {
    content: [
      {
        type: 'text',
        text: resultText
      }
    ]
  };

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
        
        await service.forceSave();
      }
    }
  }

  let resultText = `❌ Task marked as failed\n\n**Name:** ${task.name}\n**ID:** ${task.id}\n**Error:** ${task.error}\n**Failed At:** ${task.completedAt}`;
  resultText += workflowInfo;

  const result = {
    content: [
      {
        type: 'text',
        text: resultText
      }
    ]
  };

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

  const result = {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          success: true,
          task: {
            id: task.id,
            name: task.name,
            status: task.status,
            startedAt: task.startedAt
          }
        }, null, 2)
      }
    ]
  };

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

  const result = {
    content: [
      {
        type: 'text',
        text: `🔄 Task reset successfully\n\n**Name:** ${task.name}\n**ID:** ${task.id}\n**Status:** ${task.status}\n**Reset At:** ${task.updatedAt}`
      }
    ]
  };

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

  const result = {
    content: [
      {
        type: 'text',
        text: `🔄 Task retried successfully\n\n**Name:** ${task.name}\n**ID:** ${task.id}\n**Retry Count:** ${task.retries}/${task.maxRetries || '∞'}\n**Status:** ${task.status}`
      }
    ]
  };

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

  const result = {
    content: [
      {
        type: 'text',
        text: `📋 Ready to Execute - ${tasks.length} tasks\n\n${tasks.length > 0 
          ? tasks.map(t => `- **${t.name}** (ID: ${t.id})`).join('\n')
          : 'No tasks ready to execute'}`
      }
    ]
  };

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

  const result = {
    content: [
      {
        type: 'text',
        text: `${check.canExecute ? '✅' : '❌'} Task ${check.canExecute ? 'can' : 'cannot'} be executed\n\n**Task ID:** ${validated.id}\n**Can Execute:** ${check.canExecute}\n${check.reason ? `**Reason:** ${check.reason}` : ''}`
      }
    ]
  };

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
  
  await service.forceSave();

  const result = {
    content: [
      {
        type: 'text',
        text: `✅ Workflow created successfully\n\n**Name:** ${validated.name}\n**Workflow ID:** ${workflow.id}\n**Tasks:** ${validated.taskIds.length}\n**Task IDs:** ${validated.taskIds.join(', ')}`
      }
    ]
  };

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

  const result = {
    content: [
      {
        type: 'text',
        text: `📋 Workflow Details\n\n**Workflow ID:** ${validated}\n**Name:** ${workflow.name}\n**Tasks:** ${workflow.taskIds.length}\n**Task IDs:** ${workflow.taskIds.join(', ')}\n\n${tasks.length > 0 
          ? '**Tasks in workflow:\n' + tasks.map(t => `- **${t.name}** (${t.status})`).join('\n')
          : 'No tasks found'}`
      }
    ]
  };

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

  const result = {
    content: [
      {
        type: 'text',
        text: `📋 Subtasks for ${validated} - ${subtasks.length} subtasks\n\n${subtasks.length > 0 
          ? subtasks.map(t => `- **${t.name}** (${t.status}) - ID: ${t.id}`).join('\n')
          : 'No subtasks found'}`
      }
    ]
  };

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

  const result = {
    content: [
      {
        type: 'text',
        text: `📋 All Workflows - ${Object.keys(workflows).length} workflows\n\n${Object.entries(workflows).map(([id, workflow]) => 
          `- **Workflow ID:** ${id}\n  **Name:** ${(workflow as any).name}\n  **Tasks:** ${(workflow as any).taskIds.length}`
        ).join('\n')}`
      }
    ]
  };

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

  const result = {
    content: [
      {
        type: 'text',
        text: `✅ Workflow deleted successfully\n\n**Deleted Workflow ID:** ${validated}`
      }
    ]
  };

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

  const result = {
    content: [
      {
        type: 'text',
        text: '🗑️ All tasks and workflows cleared'
      }
    ]
  };

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

  const result = {
    content: [
      {
        type: 'text',
        text: '💾 State saved successfully'
      }
    ]
  };

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

  const result = {
    content: [
      {
        type: 'text',
        text: `🧹 Cleaned up ${deletedCount} workflow run(s)\n\n**Max Age:** ${validated.maxAgeMs ? `${validated.maxAgeMs}ms` : 'N/A'}\n**Max Count:** ${validated.maxCount || 'N/A'}\n**Deleted:** ${deletedCount}`
      }
    ]
  };

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

  const result = {
    content: [
      {
        type: 'text',
        text: `🧹 Task cleanup complete\n\n**Deleted:** ${cleanupResult.deleted}\n**Orphaned subtasks found:** ${cleanupResult.orphanedSubtasks}\n**Parent-completed subtasks found:** ${cleanupResult.parentCompleted}\n**Duplicate tasks found:** ${cleanupResult.duplicateTasks}\n**Stale pending tasks found:** ${cleanupResult.stalePendingTasks}${detailsText}`
      }
    ]
  };

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

  const result = {
    content: [
      {
        type: 'text',
        text: `🔧 Sequential MCP Server\n\n**Name:** sequential\n**Version:** 1.1.0\n**Description:** Sequential task execution MCP server with dependency management and workflow support\n**Features:** task_management, dependency_tracking, workflow_support, persistent_storage, execution_tracking, retry_logic, workflow_execution`
      }
    ]
  };

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

  const response = {
    content: [
      {
        type: 'text',
        text: `🚀 Workflow execution started\n\n**Run ID:** ${result.runId}\n**Workflow ID:** ${validated.workflowId}\n**Ready Tasks:** ${result.readyTasks.length}\n**Ready Task Names:** ${result.readyTasks.map(t => t.name).join(', ')}\n\n**Next Steps:**\n1. Work on the ${result.readyTasks.length} ready task(s) listed above\n2. Call complete_task (or fail_task if work fails) for each completed task\n3. Call advance_workflow_run(runId: "${result.runId}") to progress the workflow\n4. Repeat steps 1-3 until the workflow completes\n\n**Important:** Use the runId "${result.runId}" for all subsequent advance_workflow_run calls.`
      }
    ]
  };

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

  const response = {
    content: [
      {
        type: 'text',
        text: output
      }
    ]
  };

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

  const result = {
    content: [
      {
        type: 'text',
        text: `📋 Workflow Run Details\n\n**Run ID:** ${run.id}\n**Workflow ID:** ${run.workflowId}\n**Status:** ${run.status}\n**Completed Tasks:** ${run.completedTaskIds.length}\n**Active Tasks:** ${run.activeTaskIds.length}\n**Blocked Tasks:** ${run.blockedTaskIds.length}\n**Started:** ${run.startedAt}\n${run.completedAt ? `**Completed:** ${run.completedAt}` : ''}\n${run.error ? `**Error:** ${run.error}` : ''}`
      }
    ]
  };

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

  const result = {
    content: [
      {
        type: 'text',
        text: `📋 All Workflow Runs - ${runs.length} runs\n\n${runs.map(r => 
          `- **Run ID:** ${r.id} (${r.status}) - Workflow: ${r.workflowId}`
        ).join('\n')}`
      }
    ]
  };

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

  const result = {
    content: [
      {
        type: 'text',
        text: `📋 Ready Tasks in Workflow - ${tasks.length} tasks\n\n**Workflow ID:** ${validated.workflowId}\n**Ready Tasks:** ${tasks.length}\n**Ready Task Names:** ${tasks.map(t => t.name).join(', ')}\n\n${tasks.length > 0 
          ? '**Tasks:\n' + tasks.map(t => `- **${t.name}** (ID: ${t.id})`).join('\n')
          : 'No tasks ready to execute'}`
      }
    ]
  };

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

  const result = {
    content: [
      {
        type: 'text',
        text: `✅ Dependency added successfully\n\n**Task ID:** ${validated.taskId}\n**Task Name:** ${task.name}\n**Dependencies:** ${task.dependencies.length}`
      }
    ]
  };

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

  const result = {
    content: [
      {
        type: 'text',
        text: `✅ Dependency updated successfully\n\n**Task ID:** ${validated.taskId}\n**Task Name:** ${task.name}\n**Updated Dependency:** ${validated.depTaskId}`
      }
    ]
  };

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

  const result = {
    content: [
      {
        type: 'text',
        text: `✅ Task moved successfully\n\n**Task ID:** ${validated.taskId}\n**Task Name:** ${task.name}\n**New Parent:** ${validated.newParentTaskId || 'None'}\n**Position:** ${validated.position ?? 'Default'}`
      }
    ]
  };

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

  const result = {
    content: [
      {
        type: 'text',
        text: `📊 Dependency Graph\n\n**Nodes (${graph.nodes.length}):**\n${nodesText}\n\n**Edges (${graph.edges.length}):**\n${edgesText}`
      }
    ]
  };

  await logger.logToolRequest('get_dependency_graph', args, result);
  return result;
}

/**
 * Export Mermaid handler
 */
export async function handleExportMermaid(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  const validated = ExportMermaidSchema.parse(args);

  const mermaid = service.exportMermaid(validated.workflowId);

  const result = {
    content: [
      {
        type: 'text',
        text: `📊 Mermaid Flowchart\n\n\`\`\`mermaid\n${mermaid}\n\`\`\``
      }
    ]
  };

  await logger.logToolRequest('export_mermaid', args, result);
  return result;
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

  const result = {
    content: [
      {
        type: 'text',
        text: `🚫 Blocked Tasks - ${blockedTasks.length} tasks\n\n${blockedTasks.length > 0 ? tasksText : 'No blocked tasks'}`
      }
    ]
  };

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

  const result = {
    content: [
      {
        type: 'text',
        text: `🛤️ Critical Path - ${criticalPath.length} tasks\n\n**Workflow ID:** ${validated.workflowId}\n**Path Length:** ${criticalPath.length}\n\n**Critical Path:**\n${pathText}`
      }
    ]
  };

  await logger.logToolRequest('get_critical_path', args, result);
  return result;
}

/**
 * Handler registry mapping tool names to their handlers
 */
export const handlerRegistry: Record<string, (context: HandlerContext, args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>> = {
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
  export_mermaid: handleExportMermaid,
  get_blocked_tasks: handleGetBlockedTasks,
  get_critical_path: handleGetCriticalPath
};
