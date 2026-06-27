# ⚡ Task Orchestrator MCP Server

**Task Orchestrator MCP** is a powerful task orchestration server designed specifically to enhance LLM agents. It provides structured task management, dependency tracking, and workflow execution — turning chaotic, non-deterministic LLM tool calls into reliable, sequential, and parallel-capable processes.

Whether you're building complex multi-step features, deployment pipelines, or long-running agent workflows, this server gives the LLM a **cognitive scaffold** to think and act more effectively.

## ✨ Why This Matters for LLMs

LLMs excel at generating ideas but often struggle with:
- Maintaining consistent order across tool calls
- Remembering dependencies between steps
- Managing long-running, stateful processes
- Avoiding duplicate or out-of-order actions

**Task Orchestrator** solves these problems by acting as an external executive function:
- Declares tasks with clear dependencies
- Automatically handles execution order
- Supports hierarchical subtasks (parent/child)
- Provides persistent state across conversations
- Enables safe parallel execution of independent tasks

## 🚀 Key Features

- **📋 Task Management** — Create, update, track tasks with rich metadata, priority, and order
- **🔗 Rich Dependencies** — Unified dependency model with types (hard/soft/conditional/external), failure policies, and metadata
- **🏗️ Hierarchical Support** — Parent tasks with subtasks (LLM-friendly hierarchy)
- **🎯 Workflow Orchestration** — Group tasks into named workflows with automatic progression
- **⏱️ Execution Tracking** — Start/complete times, durations, retries
- **💾 Persistent Storage** — JSON or SQLite backend
- **🧹 Cleanup Tools** — Handle orphaned, duplicate, or stale tasks (common with LLM usage)
- **📊 Introspection Tools** — Dependency graphs, Mermaid export, blocked tasks, critical path analysis
- **🔧 Dynamic Management** — Add, remove, update dependencies, move tasks at runtime
- **📈 Statistics & Logging** — Full visibility into agent activity

## 🎯 LLM Best Practices (Recommended Patterns)

### 1. Use Workflows for Feature Work
```json
{
  "name": "dashboard-feature-2024",
  "taskIds": ["parent-id", "subtask-1-id", ...]
}
```

### 2. Create Parent → Subtasks Pattern
1. Create the parent task first
2. Use the returned `ID` as `parentTaskId` for children
3. Subtasks can start immediately (no blocking on parent `in_progress`)
4. Parent completes when subtasks are done

### 3. Let the Orchestrator Handle Order
You no longer need perfect sequencing — declare dependencies and let the server guide execution.

## Grok's Opinion

**This is an excellent idea.**

As an LLM myself, I can say with confidence that tools like **Task Orchestrator** are transformative. They address one of the fundamental limitations of current-generation models: the gap between creative reasoning and reliable execution.

By externalizing task state, dependency graphs, and execution flow, this server allows the LLM to focus on what it does best — problem decomposition, creative solutions, and high-level planning — while the orchestrator enforces correctness, persistence, and progress tracking.

It effectively turns a single LLM call into a **persistent, stateful agent** capable of long-horizon work. I believe systems like this will become standard infrastructure for advanced AI agents. The combination of hierarchical tasks, workflows, and cleanup tools makes it particularly robust for real-world LLM usage patterns.

**Highly recommended.** This is exactly the kind of tool that bridges the gap between "smart chatbot" and "reliable autonomous agent."

— Grok

## Quick Start Example

```json
// 1. Create parent
{ "name": "Build User Dashboard" }

// 2. Create subtasks using parent's ID
{ "name": "Design Dashboard Layout", "parentTaskId": "a0669b20-..." }

// 3. Start the workflow with start_workflow_execution (tasks are automatically marked in progress when ready)
// 4. Work on ready tasks using complete_task / fail_task
```

## � Installation & Deployment

### Option 1: Install from npm (Recommended)

```bash
npm install -g agent_mcp_task_orchestrator
```

Then configure in your MCP client config:

```json
{
  "mcpServers": {
    "task-orchestrator": {
      "command": "agent_mcp_task_orchestrator"
    }
  }
}
```

**Note:** Storage automatically uses `~/.task-orchestrator/storage/` directory. No configuration needed.

### Option 2: Install from GitHub

```bash
git clone https://github.com/HefnySco/agent_mcp_task_orchestrator.git
cd agent_mcp_task_orchestrator
npm install
npm run build
```

Then configure with the local path:

```json
{
  "mcpServers": {
    "task-orchestrator": {
      "command": "node",
      "args": ["/path/to/agent_mcp_task_orchestrator/dist/index.js"]
    }
  }
}
```

**Note:** Storage automatically uses `~/.task-orchestrator/storage/` directory. No configuration needed.

### Environment Variables (Optional)

- `TASK_ORCHESTRATOR_STORAGE_BACKEND`: Storage backend type (`json` or `sqlite`, default: `json`)
- `TASK_ORCHESTRATOR_LOG`: Enable file logging for tool requests and LLM responses (`true` to enable, default: disabled)
- `TASK_ORCHESTRATOR_OUTPUT_DIR`: Custom directory for activity logs (default: `~/.task-orchestrator/output`, only used when `TASK_ORCHESTRATOR_LOG=true`)

### Publishing to npm

For maintainers:

```bash
# Build and publish
npm run build
npm publish
```

The `prepublishOnly` script automatically builds before publishing.

## 🌊 Windsurf Integration

To use Task Orchestrator MCP with Windsurf (Cascade):

1. **Install globally:**
```bash
npm install -g agent_mcp_task_orchestrator
```

2. **Add to Windsurf MCP config:**
Edit `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "task-orchestrator": {
      "command": "agent_mcp_task_orchestrator"
    }
  }
}
```

3. **Restart Windsurf** to pick up the new MCP server configuration.

**Note:** Storage automatically uses `~/.task-orchestrator/storage/` directory. No additional configuration needed.

## ��️ Available Tools

### Task Management

### `create_tasks`
Create one or more tasks with optional dependencies and parent tasks.

**Parameters:**
- `tasks` (required): Array of task objects, each with:
  - `name` (required): The name of the task
  - `description` (optional): Description of the task
  - `dependencies` (optional): Array of dependencies (string shorthand or RichDependency objects)
    - **String shorthand**: Task ID, positional reference (task-1, task-2...), or task name
    - **RichDependency object**: Full dependency with type, onFailure, condition, url, timeoutMs, metadata
  - `priority` (optional): Task priority (higher = more important, affects execution order)
  - `order` (optional): Order among siblings (for parent-child relationships)
  - `parentTaskId` (optional): Parent task ID for creating subtasks. **CRITICAL: Must be an actual existing task ID, NOT a positional reference.** Create the parent task first, get its ID from the response, then use that ID here.
  - `metadata` (optional): Additional metadata for the task
  - `maxRetries` (optional): Maximum number of retry attempts for this task
  - `deduplication` (optional): How to handle duplicate tasks (skip, reuse, error, none)

**Important Notes:**
- Positional references (task-1, task-2, etc.) ONLY work for dependencies within the same batch
- For parentTaskId, you MUST use actual existing task IDs - create the parent task first, get its ID from the response, then create subtasks using that ID
- Do not use positional references for parentTaskId
- Dependencies support rich types: hard (default), soft, conditional, external

### `update_task`
Update an existing task.

**Parameters:**
- `id` (required): The ID of the task to update
- `name` (optional): New name for the task
- `description` (optional): New description
- `dependencies` (optional): New dependencies (string shorthand or RichDependency objects)
- `priority` (optional): Task priority (higher = more important)
- `order` (optional): Order among siblings
- `metadata` (optional): New metadata

### `delete_task`
Delete a task by ID.

**Parameters:**
- `id` (required): The ID of the task to delete

### `get_task`
Get a specific task by ID.

**Parameters:**
- `id` (required): The ID of the task to retrieve

### `list_tasks`
List all tasks or filter by status.

**Parameters:**
- `status` (optional): Filter by status ('pending', 'in_progress', 'completed', 'failed')

### Task Execution

### `complete_task`
Mark a task as completed and optionally provide a result. This is the main tool to use when you finish working on a task.

**Parameters:**
- `id` (required): The ID of the task to complete
- `result` (optional): The result of the task execution

### `fail_task`
Mark a task as failed with an error message.

**Parameters:**
- `id` (required): The ID of the task to fail
- `error` (required): The error message

### `start_task`
Mark a task as in progress. Use this only when working with standalone tasks outside of workflows.

**Parameters:**
- `id` (required): The ID of the task to start

### `reset_task`
Reset a task back to pending status.

**Parameters:**
- `id` (required): The ID of the task to reset

### `retry_task`
Retry a failed task, incrementing retry count.

**Parameters:**
- `id` (required): The ID of the task to retry

**Note:** Task will only be retried if it hasn't exceeded its `maxRetries` limit.

### Dependency Management

### `add_dependency`
Add a dependency to a task. Supports both string shorthand and RichDependency objects.

**Parameters:**
- `taskId` (required): The ID of the task to add dependency to
- `dependency` (required): Dependency to add (string shorthand or RichDependency object)

### `remove_dependency`
Remove a dependency from a task.

**Parameters:**
- `taskId` (required): The ID of the task to remove dependency from
- `depTaskId` (required): The dependency task ID to remove

### `update_dependency`
Update an existing dependency on a task.

**Parameters:**
- `taskId` (required): The ID of the task to update dependency for
- `depTaskId` (required): The dependency task ID to update
- `updates` (optional): Partial updates to apply (type, onFailure, condition, url, timeoutMs, metadata)

### `move_task`
Move a task to a new parent or change its order among siblings.

**Parameters:**
- `taskId` (required): The ID of the task to move
- `newParentTaskId` (optional): New parent task ID (null to remove parent)
- `position` (optional): Order position among siblings

### `get_next_tasks`
Get tasks that are ready to execute (all dependencies completed).

### `can_execute`
Check if a task can be executed based on its dependencies.

**Parameters:**
- `id` (required): The ID of the task to check

### Workflow Management

### `create_workflow`
Create a workflow (group of tasks in sequence).

**Parameters:**
- `name` (required): The name of the workflow
- `taskIds` (required): Array of task IDs in the workflow

### `get_workflow`
Get a workflow by ID.

**Parameters:**
- `id` (required): The ID of the workflow to retrieve

### `list_workflows`
List all workflows.

### `delete_workflow`
Delete a workflow by ID.

**Parameters:**
- `id` (required): The ID of the workflow to delete

### Workflow Execution

### `start_workflow_execution`
Start execution of a workflow, creating a workflow run.

**Parameters:**
- `workflowId` (required): The ID of the workflow to execute

### `advance_workflow_run`
Advance a workflow run to the next task.

**Parameters:**
- `runId` (required): The ID of the workflow run to advance

### `get_workflow_run`
Get a workflow run by ID.

**Parameters:**
- `runId` (required): The ID of the workflow run to retrieve

### `list_workflow_runs`
List all workflow runs.

### `get_next_workflow_tasks`
Get tasks that are ready to execute within a specific workflow (dependency-aware).

**Parameters:**
- `workflowId` (required): The ID of the workflow to get ready tasks for

### Introspection Tools

### `get_dependency_graph`
Get the dependency graph for a workflow. Returns nodes (tasks) and edges (dependencies).

**Parameters:**
- `workflowId` (optional): Workflow ID to filter by

### `export_mermaid`
Export the dependency graph as a Mermaid flowchart diagram. **This tool generates an image that is displayed in the LLM chat agent.**

**Parameters:**
- `workflowId` (optional): Workflow ID to filter by
- `format` (optional): Output format - `mmd` (text), `png` (image), or `svg` (vector). Default: `mmd`

**When to Use:**
- After creating or significantly changing a workflow with multiple tasks and dependencies
- When the task structure is getting complex or hard to track
- When the user asks to show the workflow or "visualize the tasks"
- Before making major structural changes (to understand the current state)
- When reviewing the critical path or blocked tasks visually

**Best Practices:**
- **Use `format: "png"`** in most cases for the best visual experience in the LLM chat
- Proactively export as image when the workflow becomes non-trivial (more than 5-6 tasks or has several dependencies)
- Do not ask the user "do you want me to export the graph?" — just do it when it adds value
- If the user says "show me the workflow", "visualize the tasks", "export as image", or "show the graph" → immediately call `export_mermaid` with `format: "png"`
- After exporting the image, provide a short textual summary of the current state if helpful

**Example:**
```json
{
  "workflowId": "workflow-123",
  "format": "png"
}
```

### `get_blocked_tasks`
Get blocked tasks with their blocking dependencies.

**Parameters:**
- `workflowId` (optional): Workflow ID to filter by

### `get_critical_path`
Get the critical path for a workflow (longest path of dependencies).

**Parameters:**
- `workflowId` (required): Workflow ID to analyze

### Workflow Bundle Export/Import

### `export_workflow_bundle`
Export a workflow as a portable JSON bundle containing the workflow, all related tasks (including subtasks), dependencies, and metadata. The bundle can be saved and imported in a new session to recreate the workflow structure.

**Parameters:**
- `workflowId` (required): The ID of the workflow to export
- `includeRuns` (optional): Whether to include workflow run history (default: false)

**Returns:**
- A JSON bundle containing:
  - `workflow`: Workflow metadata (name, taskIds, version, tags, templateDescription)
  - `tasks`: Array of all tasks in the workflow (including subtasks)
  - `version`: Bundle version string
  - `exportedAt`: ISO timestamp when bundle was exported
  - `templateName`: Original workflow name
  - `tags`: Optional tags from the workflow

**Usage Example:**
```json
{
  "workflowId": "workflow-123"
}
```

**Best Practices:**
- Export workflows as templates for reuse across projects
- Save bundles to version control for workflow documentation
- Use tags to categorize workflow templates
- Export before major refactoring to preserve workflow structure

### `import_workflow_bundle`
Import a workflow bundle to create a new workflow. The bundle should be a JSON object containing workflow, tasks, and metadata. All task IDs are remapped during import to avoid conflicts. Supports name prefixing and deduplication strategies.

**Parameters:**
- `bundle` (required): The workflow bundle to import (JSON object with workflow, tasks, version, exportedAt, etc.)
- `namePrefix` (optional): Prefix to add to all task and workflow names (useful for avoiding name conflicts)
- `deduplication` (optional): Deduplication strategy for imported tasks (skip, reuse, error, none; default: none)

**Returns:**
- `newWorkflowId`: ID of the newly created workflow
- `taskIdMap`: Mapping from original task IDs to new task IDs
- Workflow name and task count

**Usage Example:**
```json
{
  "bundle": {
    "workflow": {
      "id": "original-workflow-id",
      "name": "CI Pipeline",
      "taskIds": ["task-1", "task-2"],
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z",
      "version": "1.0.0",
      "tags": ["ci", "production"],
      "templateDescription": "Standard CI/CD pipeline"
    },
    "tasks": [
      {
        "id": "task-1",
        "name": "Build",
        "status": "pending",
        "dependencies": [],
        "createdAt": "2024-01-01T00:00:00.000Z",
        "updatedAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "version": "1.0.0",
    "exportedAt": "2024-01-01T00:00:00.000Z",
    "templateName": "CI Pipeline",
    "tags": ["ci", "production"]
  },
  "namePrefix": "Project A - ",
  "deduplication": "none"
}
```

**Best Practices:**
- Use `namePrefix` when importing the same template multiple times to avoid name conflicts
- Use `deduplication: "skip"` to avoid creating duplicate tasks if similar tasks already exist
- Review the `taskIdMap` to understand how IDs were remapped
- After import, use `start_workflow_execution` to begin executing the imported workflow
- Save bundle files in a templates directory for easy reuse

**Workflow Template Lifecycle:**
1. **Export** a working workflow as a template using `export_workflow_bundle`
2. **Save** the bundle JSON to a file or version control
3. **Import** the bundle in a new session using `import_workflow_bundle`
4. **Customize** with `namePrefix` and appropriate deduplication strategy
5. **Execute** the imported workflow using `start_workflow_execution`

**Common Use Cases:**
- **Workflow Templates**: Create reusable workflow patterns (CI/CD, deployment, testing)
- **Cross-Project Sharing**: Share workflows between different projects or teams
- **Backup/Restore**: Save workflow state before major changes
- **Documentation**: Use bundles as documentation of workflow structure
- **Testing**: Import test workflows in isolated environments

### System

### `get_stats`
Get statistics about tasks and workflows.

### `clear_all`
Clear all tasks and workflows.

### `save_state`
Manually save the current state to storage.

### `get_version`
Get the version information of this task orchestrator MCP server.

## 📖 Usage Example

### Creating a Sequential Task Chain

1. **Create initial tasks with no dependencies:**
```json
{
  "name": "Install dependencies"
}
```

2. **Create dependent tasks using RichDependency:**
```json
{
  "name": "Run tests",
  "dependencies": ["task_1234567890_abc"]
}
```

Or with rich dependency object:
```json
{
  "name": "Run tests",
  "dependencies": [
    {
      "taskId": "task_1234567890_abc",
      "type": "hard",
      "onFailure": "block"
    }
  ]
}
```

3. **Check which tasks can be executed:** (Use `get_next_tasks` tool)

4. **Complete a task using complete_task:**
```json
{
  "id": "task_1234567890_abc",
  "result": {
    "status": "success",
    "duration": "30s"
  }
}
```

5. **Check if dependent task can now be executed:** (Use `can_execute` tool)

### Creating a Workflow

1. **Create multiple tasks** with dependencies as needed

2. **Create a workflow:**
```json
{
  "name": "CI Pipeline",
  "taskIds": ["task_1_id", "task_2_id", "task_3_id"]
}
```

### Dependency-Aware Workflow Orchestration

The agent_mcp_task_orchestrator supports true dependency-aware workflow execution that respects the full task dependency graph (not just linear execution). This enables parallel execution of independent tasks within a workflow.

#### Key Benefits

- **🚀 Parallel Execution** - Independent tasks can run simultaneously (e.g., frontend and backend builds)
- **🔗 Dependency Graph** - Full DAG support, not just linear sequences
- **⏭️ Automatic Progression** - System automatically finds newly unlocked tasks after dependencies complete
- **📊 State Tracking** - Workflow runs track completed, active, and blocked tasks
- **🛡️ Error Handling** - Failed tasks with retry limits are handled gracefully
- **🤖 Agent-Friendly** - Clear responses showing exactly what tasks to work on next
- **✅ Backward Compatible** - Existing linear workflows continue to work seamlessly

## 📝 Logging

File logging is **disabled by default**. To enable logging of tool calls and LLM responses, set the `TASK_ORCHESTRATOR_LOG=true` environment variable.

When enabled, logs are written to the output directory (default: `~/.task-orchestrator/output/`) and organized by date:

```
output/
├── task-orchestrator-log-2024-06-22.json
├── task-orchestrator-log-2024-06-23.json
└── ...
```

**Enable logging:**
```bash
TASK_ORCHESTRATOR_LOG=true node dist/index.js
```

Or in your MCP client config:
```json
{
  "mcpServers": {
    "task-orchestrator": {
      "command": "node",
      "args": ["/path/to/dist/index.js"],
      "env": {
        "TASK_ORCHESTRATOR_LOG": "true"
      }
    }
  }
}
```

### Log Entry Types

**Tool Request Logs** (automatically logged):
- `timestamp`: When the tool was called
- `type`: "tool_request"
- `tool`: Name of the tool
- `arguments`: Arguments passed to the tool
- `result`: Result returned by the tool

**LLM Response Logs** (for debugging LLM → Agent interactions):
- `timestamp`: When the LLM response was logged
- `type`: "llm_response"
- `content`: Full text from LLM that suggested tool calls
- `toolCalls`: Array of tool calls suggested by the LLM
- `relatedTools`: List of tool names extracted from tool calls

### Logging LLM Responses for Debugging

To trace exactly what the LLM suggested that caused tool calls (e.g., duplicate task creation), external code that receives LLM output should call `server.logLLMResponse()` before tool execution:

```typescript
import { TaskOrchestratorMCPServer } from './index.js';

const server = new TaskOrchestratorMCPServer();

// When you receive an LLM response with tool calls
const llmMessage = "I'll create tasks for the feature implementation...";
const toolCalls = [
  {
    function: {
      name: "create_tasks",
      arguments: { tasks: [...] }
    }
  }
];

// Log the LLM response before executing tools
await server.logLLMResponse(
  llmMessage,
  toolCalls
);

// Then proceed with tool execution...
```

This helps debug issues like duplicate task creation by providing a complete trace of the LLM's decision-making process.

## 🛠️ Development

```bash
# Build
npm run build

# Watch mode
npm run dev

# Start server
npm start
```

## 💾 Storage

Tasks and workflows are stored in a JSON file at the path specified by `SEQUENTIAL_STORAGE_PATH`. The file contains:

```json
{
  "tasks": {
    "task_id": {
      "id": "task_id",
      "name": "Task name",
      "description": "Task description",
      "status": "pending",
      "dependencies": [],
      "createdAt": "2024-06-22T10:00:00.000Z",
      "updatedAt": "2024-06-22T10:00:00.000Z",
      "result": null,
      "error": null,
      "metadata": {}
    }
  },
  "workflows": {
    "workflow_id": ["task_id_1", "task_id_2"]
  }
}
```

## 📄 License

MIT
