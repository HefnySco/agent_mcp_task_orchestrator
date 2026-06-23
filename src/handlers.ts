import { SequentialService } from './sequentialService.js';
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
  ExecuteTaskSchema,
  FailTaskSchema,
  MarkInProgressSchema,
  ResetTaskSchema,
  RetryTaskSchema,
  CanExecuteSchema,
  WorkflowIdSchema,
  StartWorkflowExecutionSchema,
  AdvanceWorkflowRunSchema,
  GetWorkflowRunSchema,
  GetNextWorkflowTasksSchema,
  CleanupWorkflowRunsSchema
} from './validation.js';
import { ERROR_MESSAGES } from './constants.js';

/**
 * Tool handler context
 */
interface HandlerContext {
  service: SequentialService;
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

  const tasks = service.createTasks(validated.tasks);

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
  if (validated.description !== undefined) updates.description = validated.description;
  if (validated.dependencies !== undefined) updates.dependencies = validated.dependencies;
  if (validated.parentTaskId !== undefined) updates.parentTaskId = validated.parentTaskId;
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
  const validated = TaskIdSchema.parse(args);

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
  const validated = TaskIdSchema.parse(args);

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
  
  // First list parent tasks
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
 * Execute task handler
 */
export async function handleExecuteTask(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  // Validate input
  const validated = ExecuteTaskSchema.parse(args);

  const task = service.executeTask(validated.id, validated.result);
  
  if (!task) {
    throw new TaskExecutionError(validated.id, ERROR_MESSAGES.DEPENDENCY_NOT_MET);
  }

  await service.forceSave();

  // Format result safely to avoid JSON parsing issues
  let resultText = `✅ Task executed successfully\n\n**Name:** ${task.name}\n**ID:** ${task.id}\n**Status:** ${task.status}`;
  if (task.completedAt) {
    resultText += `\n**Completed:** ${task.completedAt}`;
  }

  const result = {
    content: [
      {
        type: 'text',
        text: resultText
      }
    ]
  };

  await logger.logToolRequest('execute_task', args, result);
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

  const result = {
    content: [
      {
        type: 'text',
        text: `❌ Task marked as failed\n\n**Name:** ${task.name}\n**ID:** ${task.id}\n**Error:** ${task.error}\n**Failed At:** ${task.completedAt}`
      }
    ]
  };

  await logger.logToolRequest('fail_task', args, result);
  return result;
}

/**
 * Mark task in progress handler
 */
export async function handleMarkInProgress(
  context: HandlerContext,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { service, logger } = context;

  // Validate input
  const validated = MarkInProgressSchema.parse(args);

  const task = service.markTaskInProgress(validated.id);
  
  if (!task) {
    throw new TaskExecutionError(validated.id, ERROR_MESSAGES.DEPENDENCY_NOT_MET);
  }

  await service.forceSave();

  const result = {
    content: [
      {
        type: 'text',
        text: `🔄 Task marked as in progress\n\n**Name:** ${task.name}\n**ID:** ${task.id}\n**Started:** ${task.startedAt}`
      }
    ]
  };

  await logger.logToolRequest('mark_in_progress', args, result);
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
  const validated = WorkflowIdSchema.parse(args);

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
  const validated = TaskIdSchema.parse(args);

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
  const validated = WorkflowIdSchema.parse(args);

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

  service.clearAll();
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
        text: `🚀 Workflow execution started\n\n**Run ID:** ${result.runId}\n**Workflow ID:** ${validated.workflowId}\n**Ready Tasks:** ${result.readyTasks.length}\n**Ready Task Names:** ${result.readyTasks.map(t => t.name).join(', ')}`
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

  const response = {
    content: [
      {
        type: 'text',
        text: `➡️ Workflow run advanced\n\n**Run ID:** ${result.run.id}\n**Status:** ${result.run.status}\n**Completed Tasks:** ${result.run.completedTaskIds.length}\n**Active Tasks:** ${result.run.activeTaskIds.length}\n**Blocked Tasks:** ${result.run.blockedTaskIds.length}\n**New Ready Tasks:** ${result.newReadyTasks.length}\n**New Ready Task Names:** ${result.newReadyTasks.map(t => t.name).join(', ')}`
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
 * Handler registry mapping tool names to their handlers
 */
export const handlerRegistry: Record<string, (context: HandlerContext, args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>> = {
  create_tasks: handleCreateTasks,
  update_task: handleUpdateTask,
  delete_task: handleDeleteTask,
  get_task: handleGetTask,
  get_subtasks: handleGetSubtasks,
  list_tasks: handleListTasks,
  execute_task: handleExecuteTask,
  fail_task: handleFailTask,
  mark_in_progress: handleMarkInProgress,
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
  cleanup_workflow_runs: handleCleanupWorkflowRuns
};
