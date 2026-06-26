/**
 * Task status constants
 */
export const TASK_STATUS = {
  PENDING: 'pending' as const,
  IN_PROGRESS: 'in_progress' as const,
  COMPLETED: 'completed' as const,
  FAILED: 'failed' as const
} as const;

/**
 * Error code constants
 */
export const ERROR_CODES = {
  TASK_NOT_FOUND: 'TASK_NOT_FOUND',
  WORKFLOW_NOT_FOUND: 'WORKFLOW_NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  TASK_EXECUTION_ERROR: 'TASK_EXECUTION_ERROR',
  DEPENDENCY_NOT_FOUND: 'DEPENDENCY_NOT_FOUND',
  STORAGE_ERROR: 'STORAGE_ERROR',
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR'
} as const;

/**
 * Error message constants
 */
export const ERROR_MESSAGES = {
  TASK_NOT_FOUND: 'Task not found',
  WORKFLOW_NOT_FOUND: 'Workflow not found',
  TASK_NAME_REQUIRED: 'Task name is required',
  TASK_ID_REQUIRED: 'Task ID is required',
  WORKFLOW_ID_REQUIRED: 'Workflow ID is required',
  WORKFLOW_NAME_REQUIRED: 'Workflow name is required',
  WORKFLOW_TASK_IDS_REQUIRED: 'Workflow task IDs are required',
  ERROR_MESSAGE_REQUIRED: 'Error message is required',
  INVALID_TASK_STATUS: 'Invalid task status',
  DEPENDENCY_NOT_MET: 'Dependencies not met',
  TASK_CANNOT_BE_EXECUTED: 'Task cannot be executed',
  TASK_CANNOT_BE_STARTED: 'Task cannot be started'
} as const;

/**
 * Server configuration constants
 */
export const SERVER_CONFIG = {
  NAME: 'task-orchestrator',
  VERSION: '1.1.0',
  DESCRIPTION: 'Task orchestration MCP server with dependency management and workflow support'
} as const;

/**
 * File operation constants
 */
export const FILE_CONFIG = {
  DEFAULT_STORAGE_FILENAME: 'task-orchestrator-storage.json',
  DEFAULT_OUTPUT_DIR: 'output',
  LOG_FILE_PREFIX: 'task-orchestrator-log-',
  LOG_FILE_EXTENSION: '.json'
} as const;

/**
 * Validation constants
 */
export const VALIDATION = {
  MAX_TASK_NAME_LENGTH: 255,
  MAX_DESCRIPTION_LENGTH: 1000,
  MAX_WORKFLOW_NAME_LENGTH: 255
} as const;
