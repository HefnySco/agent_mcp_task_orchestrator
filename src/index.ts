#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { TaskOrchestratorService } from './taskOrchestratorService.js';
import { getConfigManager } from './config.js';
import { getLogger } from './logger.js';
import { handlerRegistry } from './handlers.js';
import { SERVER_CONFIG } from './constants.js';
import { ZodError } from 'zod';
import { SequentialError } from './errors.js';
import { StorageFactory } from './storage/StorageFactory.js';

/**
 * Task Orchestrator MCP Server - Main server class
 */
class TaskOrchestratorMCPServer {
  private server: Server;
  private taskOrchestratorService: TaskOrchestratorService;
  private storageAdapter: any;
  private logger: ReturnType<typeof getLogger>;

  constructor() {
    const config = getConfigManager();
    this.logger = getLogger();
    
    this.server = new Server(
      {
        name: SERVER_CONFIG.NAME,
        version: SERVER_CONFIG.VERSION,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.storageAdapter = StorageFactory.createAdapter(
      config.getStorageBackend(),
      config.getStoragePath()
    );
    
    this.taskOrchestratorService = new TaskOrchestratorService(this.storageAdapter);
    
    this.setupHandlers();
  }

  private async initializeAsync(): Promise<void> {
    const config = getConfigManager();
    this.logger.info('Initializing storage', { 
      backend: config.getStorageBackend(),
      path: config.getStoragePath()
    });
    
    try {
      await this.storageAdapter.initialize();
    } catch (err) {
      this.logger.error('Failed to initialize storage adapter', { error: err });
      console.error('❌ Storage adapter initialization failed:', err);
      throw new Error(`Storage adapter initialization failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    
    try {
      await this.taskOrchestratorService.load();
    } catch (err) {
      this.logger.error('Failed to load state from storage', { error: err });
      console.error('❌ State load failed:', err);
      throw new Error(`Failed to load state from storage: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Setup MCP request handlers
   */
  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          // ============================================================================
          // USAGE MODES
          // ============================================================================
          //
          // This MCP server supports two usage modes:
          //
          // 1. SIMPLE MODE (for basic task management):
          //    - create_tasks → start_task → complete_task
          //    - Use this for simple, ad-hoc tasks without complex dependencies
          //
          // 2. RECOMMENDED WORKFLOW MODE (for organized task execution):
          //    - create_tasks → create_workflow → start_workflow_execution
          //    - [do work on ready tasks] → complete_task/fail_task → advance_workflow_run
          //    - Repeat the [do work] → advance cycle until workflow completes
          //    - Use this for complex, multi-step workflows with dependencies
          //
          // The workflow mode provides automatic task state management, dependency
          // tracking, and clearer execution flow. It's the recommended approach for
          // most use cases.
          //
          // ============================================================================
          {
            name: 'create_tasks',
            description: 'Create one or more tasks with optional dependencies and parent tasks. IMPORTANT: For new independent task groups, strongly prefer using create_workflow instead to keep tasks organized and avoid hanging tasks. Duplicate tasks are skipped by default (use deduplication: "none" per task to force creation). Dependencies can be specified as: positional references (task-1, task-2, etc.) within the same batch, existing task IDs, or task names (matched case-insensitively against tasks in this batch and existing tasks). Dependencies also support a rich object form with type (hard/soft/conditional/external), onFailure policy, condition, url, timeoutMs, and metadata. CRITICAL: For parentTaskId, you MUST use actual existing task IDs - create the parent task first, get its ID from the response, then create subtasks using that ID. Do not use positional references or task names for parentTaskId.',
            inputSchema: {
              type: 'object',
              properties: {
                tasks: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: {
                        type: 'string',
                        description: 'The name of the task'
                      },
                      description: {
                        type: 'string',
                        description: 'Optional description of the task'
                      },
                      dependencies: {
                        type: 'array',
                        items: {
                          oneOf: [
                            { type: 'string', description: 'Task ID, positional reference (task-1, task-2...), or task name' },
                            {
                              type: 'object',
                              properties: {
                                taskId: { type: 'string', description: 'Task ID, positional reference, or task name' },
                                type: { type: 'string', enum: ['hard', 'soft', 'conditional', 'external'], description: 'Dependency type' },
                                onFailure: { type: 'string', enum: ['block', 'skip', 'proceed'], description: 'Policy when dependency fails' },
                                condition: { type: 'string', description: 'Condition for conditional dependencies' },
                                url: { type: 'string', description: 'URL for external dependencies' },
                                timeoutMs: { type: 'number', description: 'Timeout in milliseconds' },
                                metadata: { type: 'object', description: 'Dependency metadata (reason, createdBy, createdAt, priorityBoost)' }
                              },
                              required: ['taskId']
                            }
                          ]
                        },
                        description: 'Array of dependencies (string shorthand or RichDependency objects)'
                      },
                      priority: {
                        type: 'number',
                        description: 'Task priority (higher = more important, affects execution order)'
                      },
                      order: {
                        type: 'number',
                        description: 'Order among siblings (for parent-child relationships)'
                      },
                      parentTaskId: {
                        type: 'string',
                        description: 'Optional parent task ID for creating subtasks. CRITICAL: Must be an actual existing task ID, NOT a positional reference (task-1, task-2). Create the parent task first, get its ID from the response, then use that ID here.'
                      },
                      metadata: {
                        type: 'object',
                        description: 'Optional metadata for the task'
                      },
                      maxRetries: {
                        type: 'number',
                        description: 'Maximum number of retry attempts for this task'
                      },
                      deduplication: {
                        type: 'string',
                        enum: ['skip', 'reuse', 'error', 'none'],
                        description: 'How to handle duplicate tasks (same name/parent). Default is skip.'
                      }
                    },
                    required: ['name']
                  },
                  description: 'Array of tasks to create'
                }
              },
              required: ['tasks']
            }
          },
          {
            name: 'update_task',
            description: 'Update an existing task. Dependencies support both string shorthand and RichDependency objects.',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'The ID of the task to update'
                },
                name: {
                  type: 'string',
                  description: 'New name for the task'
                },
                description: {
                  type: 'string',
                  description: 'New description for the task'
                },
                dependencies: {
                  type: 'array',
                  items: {
                    oneOf: [
                      { type: 'string', description: 'Task ID, positional reference, or task name' },
                      {
                        type: 'object',
                        properties: {
                          taskId: { type: 'string', description: 'Task ID, positional reference, or task name' },
                          type: { type: 'string', enum: ['hard', 'soft', 'conditional', 'external'], description: 'Dependency type' },
                          onFailure: { type: 'string', enum: ['block', 'skip', 'proceed'], description: 'Policy when dependency fails' },
                          condition: { type: 'string', description: 'Condition for conditional dependencies' },
                          url: { type: 'string', description: 'URL for external dependencies' },
                          timeoutMs: { type: 'number', description: 'Timeout in milliseconds' },
                          metadata: { type: 'object', description: 'Dependency metadata' }
                        },
                        required: ['taskId']
                      }
                    ]
                  },
                  description: 'New dependencies for the task (string shorthand or RichDependency objects)'
                },
                priority: {
                  type: 'number',
                  description: 'Task priority (higher = more important)'
                },
                order: {
                  type: 'number',
                  description: 'Order among siblings'
                },
                parentTaskId: {
                  type: 'string',
                  description: 'New parent task ID for the task'
                },
                metadata: {
                  type: 'object',
                  description: 'New metadata for the task'
                }
              },
              required: ['id']
            }
          },
          {
            name: 'delete_task',
            description: 'Delete a task by ID',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'The ID of the task to delete'
                }
              },
              required: ['id']
            }
          },
          {
            name: 'get_task',
            description: 'Get a specific task by ID',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'The ID of the task to retrieve'
                }
              },
              required: ['id']
            }
          },
          {
            name: 'get_subtasks',
            description: 'Get all subtasks of a parent task',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'The parent task ID to get subtasks for'
                }
              },
              required: ['id']
            }
          },
          {
            name: 'list_tasks',
            description: 'List all tasks or filter by status. Tasks are organized by workflow membership. Use this to review task organization and identify tasks that need workflow grouping. Consider using create_workflow to group related tasks for better management.',
            inputSchema: {
              type: 'object',
              properties: {
                status: {
                  type: 'string',
                  enum: ['pending', 'in_progress', 'completed', 'failed'],
                  description: 'Filter tasks by status (optional)'
                }
              }
            }
          },
          {
            name: 'complete_task',
            description: 'Mark a task as completed and optionally provide a result. This is the main tool to use when you finish working on a task. **When used inside an active workflow, this automatically advances the workflow** and unlocks the next ready tasks. The response will include workflow information showing newly ready tasks and workflow status. To disable auto-advance, set autoAdvance: false. The result parameter expects an object directly, NOT a JSON string.',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'The ID of the task to complete'
                },
                result: {
                  type: 'object',
                  description: 'The result of the task execution'
                },
                autoAdvance: {
                  type: 'boolean',
                  description: 'Whether to automatically advance the workflow if this task is in an active workflow run (default: true)'
                }
              },
              required: ['id']
            }
          },
          {
            name: 'fail_task',
            description: 'Mark a task as failed with an error message. **When used inside an active workflow, this automatically advances the workflow** and the system will handle failure propagation based on dependency rules. The response will include workflow information showing newly ready tasks and workflow status. To disable auto-advance, set autoAdvance: false.',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'The ID of the task to fail'
                },
                error: {
                  type: 'string',
                  description: 'The error message'
                },
                autoAdvance: {
                  type: 'boolean',
                  description: 'Whether to automatically advance the workflow if this task is in an active workflow run (default: true)'
                }
              },
              required: ['id', 'error']
            }
          },
          {
            name: 'start_task',
            description: 'Mark a task as in progress. **Use this only when working with standalone tasks outside of workflows.** In workflow-based execution, tasks are usually marked as in progress automatically when they become ready.',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'The ID of the task to start'
                }
              },
              required: ['id']
            }
          },
          {
            name: 'reset_task',
            description: 'Reset a task back to pending status',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'The ID of the task to reset'
                }
              },
              required: ['id']
            }
          },
          {
            name: 'retry_task',
            description: 'Retry a failed task, incrementing retry count',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'The ID of the task to retry'
                }
              },
              required: ['id']
            }
          },
          {
            name: 'get_next_tasks',
            description: 'Get tasks that are ready to execute (all dependencies completed)',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'can_execute',
            description: 'Check if a task can be executed based on its dependencies',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'The ID of the task to check'
                }
              },
              required: ['id']
            }
          },
          {
            name: 'create_workflow',
            description: 'Create a workflow (group of tasks in sequence). **RECOMMENDED:** Use workflows for new independent task groups/sessions instead of loose tasks. Workflows provide automatic task grouping, dependency-aware execution, session isolation, and easier cleanup. This is the preferred way to organize coherent task groups (e.g., "deploy-production", "fix-bug-123", "feature-implementation").\n\n**Recommended Usage:**\n1. Create tasks using create_tasks\n2. Create a workflow with those tasks using create_workflow\n3. Start execution with start_workflow_execution (returns runId + ready tasks)\n4. Perform work on ready tasks, then call complete_task/fail_task\n5. Call advance_workflow_run(runId) to progress the workflow\n6. Repeat steps 4-5 until workflow completes\n\nThis pattern ensures proper task state management and avoids confusion with manual start_task calls.',
            inputSchema: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'The name of the workflow. Use a descriptive name that reflects the session/purpose (e.g., "deploy-production", "bugfix-auth-issue")'
                },
                taskIds: {
                  type: 'array',
                  items: {
                    type: 'string'
                  },
                  description: 'Array of task IDs in the workflow. Tasks should be created first using create_tasks.'
                }
              },
              required: ['name', 'taskIds']
            }
          },
          {
            name: 'get_workflow',
            description: 'Get a workflow by ID',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'The ID of the workflow to retrieve'
                }
              },
              required: ['id']
            }
          },
          {
            name: 'list_workflows',
            description: 'List all workflows',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'delete_workflow',
            description: 'Delete a workflow by ID',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'The ID of the workflow to delete'
                }
              },
              required: ['id']
            }
          },
          {
            name: 'start_workflow_execution',
            description: 'Start execution of a workflow with dependency-aware task initialization. Automatically finds and marks all initially ready tasks as in_progress. Returns runId and list of ready tasks.\n\n**RECOMMENDED Workflow Execution Pattern (with auto-advance):**\n1. Call start_workflow_execution to get runId and ready tasks\n2. Perform work on ready tasks\n3. Call complete_task (or fail_task) - this automatically advances the workflow\n4. The response shows newly ready tasks - continue working on them\n5. Repeat steps 3-4 until workflow completes\n\n**Note:** complete_task and fail_task auto-advance workflows by default, so you typically do not need to call advance_workflow_run manually. Use advance_workflow_run only if you disabled auto-advance or need manual control.\n\n**Important:** Do NOT call start_task manually when using workflows - the workflow execution system handles task state automatically.',
            inputSchema: {
              type: 'object',
              properties: {
                workflowId: {
                  type: 'string',
                  description: 'The ID of the workflow to execute'
                }
              },
              required: ['workflowId']
            }
          },
          {
            name: 'advance_workflow_run',
            description: 'Advance a workflow run by finding newly unlocked tasks after tasks are completed/failed. Returns detailed information including completed tasks, failed tasks, newly ready tasks, blocked tasks, workflow status, and a human-readable summary. Supports smart failure handling that only fails the workflow when no paths forward remain (unless continueOnFailure is enabled).\n\n**When to Use This Tool:**\n- Typically NOT needed - complete_task and fail_task auto-advance workflows by default\n- Use this if you disabled auto-advance (autoAdvance: false) in complete_task/fail_task\n- Use this for manual control over workflow progression\n- Use this to check workflow status without completing tasks\n\n**What the Response Tells You:**\n- Current workflow status (in_progress, completed, failed)\n- Which tasks just completed or failed\n- List of newly ready tasks you should work on next\n- Any blocked tasks waiting for dependencies\n- A human-readable summary of what happened\n\n**Important:** Always use the runId returned by start_workflow_execution for all subsequent calls to this tool.\n\n**Response Format:** Returns a consistent JSON structure with `success`, `data`, `displayOutput`, `error`, and `metadata` fields. Always show the `displayOutput` field to the user for human-readable information.',
            inputSchema: {
              type: 'object',
              properties: {
                runId: {
                  type: 'string',
                  description: 'The ID of the workflow run to advance'
                }
              },
              required: ['runId']
            }
          },
          {
            name: 'get_workflow_run',
            description: 'Get a workflow run by ID',
            inputSchema: {
              type: 'object',
              properties: {
                runId: {
                  type: 'string',
                  description: 'The ID of the workflow run to retrieve'
                }
              },
              required: ['runId']
            }
          },
          {
            name: 'list_workflow_runs',
            description: 'List all workflow runs',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'get_next_workflow_tasks',
            description: 'Get tasks that are ready to execute within a specific workflow (dependency-aware). Useful for checking what can be worked on next in a workflow context. Note: When using the recommended workflow execution pattern (start_workflow_execution → complete_task → advance_workflow_run), you typically do not need to call this tool separately, as advance_workflow_run will tell you which tasks are newly ready. Use this tool if you want to inspect ready tasks without advancing the workflow state.',
            inputSchema: {
              type: 'object',
              properties: {
                workflowId: {
                  type: 'string',
                  description: 'The ID of the workflow to get ready tasks for'
                }
              },
              required: ['workflowId']
            }
          },
          {
            name: 'get_stats',
            description: 'Get statistics about tasks and workflows. Use this to monitor task organization and workflow health. Well-organized tasks should be grouped by workflow. Consider creating workflows for loose task groups to improve workflow management.',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'clear_all',
            description: 'Clear all tasks and workflows',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'save_state',
            description: 'Manually save the current state to storage',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'get_version',
            description: 'Get the version information of this sequential MCP server',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'cleanup_workflow_runs',
            description: 'Clean up old workflow runs based on age or count',
            inputSchema: {
              type: 'object',
              properties: {
                maxAgeMs: {
                  type: 'number',
                  description: 'Maximum age in milliseconds for workflow runs to keep (optional)'
                },
                maxCount: {
                  type: 'number',
                  description: 'Maximum number of workflow runs to keep (optional, keeps most recent)'
                }
              }
            }
          },
          {
            name: 'cleanup_tasks',
            description: 'Identify and optionally delete hanging/orphaned tasks: orphaned subtasks (parent missing), subtasks left pending after parent completed, duplicate tasks, and stale pending tasks. Use this to maintain storage health when LLM-driven task creation leaves incomplete or duplicate tasks behind.',
            inputSchema: {
              type: 'object',
              properties: {
                deleteOrphans: {
                  type: 'boolean',
                  description: 'Delete subtasks whose parent task no longer exists'
                },
                deleteParentCompleted: {
                  type: 'boolean',
                  description: 'Delete subtasks that are still pending after their parent completed'
                },
                deleteDuplicates: {
                  type: 'boolean',
                  description: 'Delete duplicate tasks (same name/parentTaskId), keeping the oldest'
                },
                deleteStalePending: {
                  type: 'boolean',
                  description: 'Delete pending tasks that have not been started for a long time'
                },
                stalePendingMs: {
                  type: 'number',
                  description: 'Age threshold in milliseconds for stale pending tasks (default 24 hours)'
                }
              }
            }
          },
          {
            name: 'add_dependency',
            description: 'Add a dependency to a task. Supports both string shorthand and RichDependency objects.',
            inputSchema: {
              type: 'object',
              properties: {
                taskId: {
                  type: 'string',
                  description: 'The ID of the task to add dependency to'
                },
                dependency: {
                  oneOf: [
                    { type: 'string', description: 'Task ID, positional reference, or task name' },
                    {
                      type: 'object',
                      properties: {
                        taskId: { type: 'string', description: 'Task ID, positional reference, or task name' },
                        type: { type: 'string', enum: ['hard', 'soft', 'conditional', 'external'], description: 'Dependency type' },
                        onFailure: { type: 'string', enum: ['block', 'skip', 'proceed'], description: 'Policy when dependency fails' },
                        condition: { type: 'string', description: 'Condition for conditional dependencies' },
                        url: { type: 'string', description: 'URL for external dependencies' },
                        timeoutMs: { type: 'number', description: 'Timeout in milliseconds' },
                        metadata: { type: 'object', description: 'Dependency metadata' }
                      },
                      required: ['taskId']
                    }
                  ],
                  description: 'Dependency to add (string shorthand or RichDependency object)'
                }
              },
              required: ['taskId', 'dependency']
            }
          },
          {
            name: 'remove_dependency',
            description: 'Remove a dependency from a task',
            inputSchema: {
              type: 'object',
              properties: {
                taskId: {
                  type: 'string',
                  description: 'The ID of the task to remove dependency from'
                },
                depTaskId: {
                  type: 'string',
                  description: 'The dependency task ID to remove'
                }
              },
              required: ['taskId', 'depTaskId']
            }
          },
          {
            name: 'update_dependency',
            description: 'Update an existing dependency on a task',
            inputSchema: {
              type: 'object',
              properties: {
                taskId: {
                  type: 'string',
                  description: 'The ID of the task to update dependency for'
                },
                depTaskId: {
                  type: 'string',
                  description: 'The dependency task ID to update'
                },
                updates: {
                  type: 'object',
                  properties: {
                    type: { type: 'string', enum: ['hard', 'soft', 'conditional', 'external'], description: 'Dependency type' },
                    onFailure: { type: 'string', enum: ['block', 'skip', 'proceed'], description: 'Policy when dependency fails' },
                    condition: { type: 'string', description: 'Condition for conditional dependencies' },
                    url: { type: 'string', description: 'URL for external dependencies' },
                    timeoutMs: { type: 'number', description: 'Timeout in milliseconds' },
                    metadata: { type: 'object', description: 'Dependency metadata' }
                  },
                  description: 'Partial updates to apply to the dependency'
                }
              },
              required: ['taskId', 'depTaskId']
            }
          },
          {
            name: 'move_task',
            description: 'Move a task to a new parent or change its order among siblings',
            inputSchema: {
              type: 'object',
              properties: {
                taskId: {
                  type: 'string',
                  description: 'The ID of the task to move'
                },
                newParentTaskId: {
                  type: 'string',
                  description: 'New parent task ID (null to remove parent)'
                },
                position: {
                  type: 'number',
                  description: 'Order position among siblings'
                }
              },
              required: ['taskId']
            }
          },
          {
            name: 'get_dependency_graph',
            description: 'Get the dependency graph for a workflow. Returns nodes (tasks) and edges (dependencies).',
            inputSchema: {
              type: 'object',
              properties: {
                workflowId: {
                  type: 'string',
                  description: 'Optional workflow ID to filter by'
                }
              }
            }
          },
          {
            name: 'export_mermaid',
            description: 'Export the dependency graph as a Mermaid flowchart diagram. **Generates an image (PNG) by default for display in the LLM chat.** Supports text (mmd), PNG, and SVG formats.',
            inputSchema: {
              type: 'object',
              properties: {
                workflowId: {
                  type: 'string',
                  description: 'Optional workflow ID to filter by'
                },
                format: {
                  type: 'string',
                  enum: ['mmd', 'png', 'svg'],
                  description: 'Output format: mmd for raw text (default), png for image, svg for vector'
                }
              }
            }
          },
          {
            name: 'export_graph_image',
            description: 'Export the dependency graph as a rendered image (PNG or SVG). This is a dedicated tool for image-only output. Returns `type: "image"` with the rendered image data.\n\n**Response Format:** Returns `type: "image"` with the rendered image data and a text message about the file save location.',
            inputSchema: {
              type: 'object',
              properties: {
                workflowId: {
                  type: 'string',
                  description: 'Optional workflow ID to filter by'
                },
                format: {
                  type: 'string',
                  enum: ['png', 'svg'],
                  description: 'Output format: png for raster image, svg for vector (default: png)'
                }
              }
            }
          },
          {
            name: 'get_blocked_tasks',
            description: 'Get blocked tasks with their blocking dependencies',
            inputSchema: {
              type: 'object',
              properties: {
                workflowId: {
                  type: 'string',
                  description: 'Optional workflow ID to filter by'
                }
              }
            }
          },
          {
            name: 'get_critical_path',
            description: 'Get the critical path for a workflow (longest path of dependencies)',
            inputSchema: {
              type: 'object',
              properties: {
                workflowId: {
                  type: 'string',
                  description: 'Workflow ID to analyze'
                }
              },
              required: ['workflowId']
            }
          },
          {
            name: 'export_workflow_bundle',
            description: 'Export a workflow as a portable JSON bundle containing the workflow, all related tasks (including subtasks), dependencies, and metadata. The bundle can be saved and imported in a new session to recreate the workflow structure.',
            inputSchema: {
              type: 'object',
              properties: {
                workflowId: {
                  type: 'string',
                  description: 'The ID of the workflow to export'
                },
                includeRuns: {
                  type: 'boolean',
                  description: 'Whether to include workflow run history (optional)'
                }
              },
              required: ['workflowId']
            }
          },
          {
            name: 'import_workflow_bundle',
            description: 'Import a workflow bundle to create a new workflow. The bundle should be a JSON object containing workflow, tasks, and metadata. All task IDs are remapped during import to avoid conflicts. Supports name prefixing and deduplication strategies.',
            inputSchema: {
              type: 'object',
              properties: {
                bundle: {
                  type: 'object',
                  description: 'The workflow bundle to import (JSON object with workflow, tasks, version, exportedAt, etc.)',
                  properties: {
                    workflow: {
                      type: 'object',
                      description: 'Workflow metadata',
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                        taskIds: { type: 'array', items: { type: 'string' } },
                        createdAt: { type: 'string' },
                        updatedAt: { type: 'string' },
                        version: { type: 'string' },
                        tags: { type: 'array', items: { type: 'string' } },
                        templateDescription: { type: 'string' }
                      },
                      required: ['id', 'name', 'taskIds', 'createdAt', 'updatedAt']
                    },
                    tasks: {
                      type: 'array',
                      description: 'Array of tasks in the workflow',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          name: { type: 'string' },
                          description: { type: 'string' },
                          status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'failed'] },
                          dependencies: { type: 'array', items: { type: 'object' } },
                          priority: { type: 'number' },
                          order: { type: 'number' },
                          parentTaskId: { type: 'string' },
                          createdAt: { type: 'string' },
                          updatedAt: { type: 'string' },
                          startedAt: { type: 'string' },
                          completedAt: { type: 'string' },
                          retries: { type: 'number' },
                          maxRetries: { type: 'number' },
                          timeoutMs: { type: 'number' },
                          result: {},
                          error: { type: 'string' },
                          metadata: { type: 'object' }
                        },
                        required: ['id', 'name', 'status', 'dependencies', 'createdAt', 'updatedAt']
                      }
                    },
                    version: {
                      type: 'string',
                      description: 'Bundle version'
                    },
                    exportedAt: {
                      type: 'string',
                      description: 'ISO timestamp when bundle was exported'
                    },
                    templateName: {
                      type: 'string',
                      description: 'Optional template name'
                    },
                    tags: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Optional tags'
                    }
                  },
                  required: ['workflow', 'tasks', 'version', 'exportedAt']
                },
                namePrefix: {
                  type: 'string',
                  description: 'Optional prefix to add to all task and workflow names'
                },
                deduplication: {
                  type: 'string',
                  enum: ['skip', 'reuse', 'error', 'none'],
                  description: 'Deduplication strategy for imported tasks (default: none)'
                }
              },
              required: ['bundle']
            }
          }
        ]
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      const handler = handlerRegistry[name];
      if (!handler) {
        this.logger.error(`Unknown tool: ${name}`);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: `Unknown tool: ${name}`
              }, null, 2)
            }
          ]
        };
      }

      try {
        const context = {
          service: this.taskOrchestratorService,
          logger: this.logger
        };
        return await handler(context, args || {});
      } catch (error) {
        this.logger.error(`Error executing tool ${name}`, { error });

        if (error instanceof ZodError) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'Validation error',
                  details: error.errors
                }, null, 2)
              }
            ]
          };
        }

        if (error instanceof SequentialError) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: error.message,
                  code: error.code
                }, null, 2)
              }
            ]
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: error instanceof Error ? error.message : 'Unknown error'
              }, null, 2)
            }
          ]
        };
      }
    });
  }

  /**
   * Start the MCP server
   */
  async run() {
    // Initialize storage adapter and load state (blocking)
    await this.initializeAsync();

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.logger.info('Task Orchestrator MCP server running on stdio');
  }

  /**
   * Log LLM response externally (for debugging LLM → Agent interactions)
   * This can be called from outside the MCP server to log LLM messages
   */
  async logLLMResponse(
    message: string,
    toolCalls?: any[],
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.logger.logLLMResponse(message, toolCalls, metadata);
  }
}

const server = new TaskOrchestratorMCPServer();
server.run().catch(console.error);
