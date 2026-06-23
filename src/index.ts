#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { SequentialService } from './sequentialService.js';
import { getConfigManager } from './config.js';
import { getLogger } from './logger.js';
import { handlerRegistry } from './handlers.js';
import { SERVER_CONFIG } from './constants.js';
import { ZodError } from 'zod';
import { SequentialError } from './errors.js';

/**
 * Sequential MCP Server - Main server class
 */
class SequentialMCPServer {
  private server: Server;
  private sequentialService: SequentialService;
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

    this.sequentialService = new SequentialService(config.getStoragePath());
    this.sequentialService.load().catch(err => {
      this.logger.error('Failed to load sequential service state', { error: err });
    });
    
    this.setupHandlers();
  }

  /**
   * Setup MCP request handlers
   */
  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'create_tasks',
            description: 'Create one or more tasks with optional dependencies and parent tasks',
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
                          type: 'string'
                        },
                        description: 'Array of task IDs that this task depends on'
                      },
                      parentTaskId: {
                        type: 'string',
                        description: 'Optional parent task ID for creating subtasks'
                      },
                      metadata: {
                        type: 'object',
                        description: 'Optional metadata for the task'
                      },
                      maxRetries: {
                        type: 'number',
                        description: 'Maximum number of retry attempts for this task'
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
            description: 'Update an existing task',
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
                    type: 'string'
                  },
                  description: 'New dependencies for the task'
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
            description: 'List all tasks or filter by status',
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
            name: 'execute_task',
            description: 'Mark a task as completed with a result',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'The ID of the task to execute'
                },
                result: {
                  type: 'object',
                  description: 'The result of the task execution'
                }
              },
              required: ['id']
            }
          },
          {
            name: 'fail_task',
            description: 'Mark a task as failed with an error message',
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
                }
              },
              required: ['id', 'error']
            }
          },
          {
            name: 'mark_in_progress',
            description: 'Mark a task as in progress',
            inputSchema: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'The ID of the task to mark as in progress'
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
            description: 'Create a workflow (group of tasks in sequence)',
            inputSchema: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'The name of the workflow'
                },
                taskIds: {
                  type: 'array',
                  items: {
                    type: 'string'
                  },
                  description: 'Array of task IDs in the workflow'
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
            description: 'Start execution of a workflow with dependency-aware task initialization. Automatically finds and marks all initially ready tasks as in_progress. Returns runId and list of ready tasks.',
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
            description: 'Advance a workflow run by finding newly unlocked tasks after tasks are completed/failed. Returns detailed information including completed tasks, failed tasks, newly ready tasks, blocked tasks, workflow status, and a human-readable summary. Supports smart failure handling that only fails the workflow when no paths forward remain (unless continueOnFailure is enabled).',
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
            description: 'Get tasks that are ready to execute within a specific workflow (dependency-aware). Useful for checking what can be worked on next in a workflow context.',
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
            description: 'Get statistics about tasks and workflows',
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
          service: this.sequentialService,
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
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.logger.info('Sequential MCP server running on stdio');
  }
}

const server = new SequentialMCPServer();
server.run().catch(console.error);
