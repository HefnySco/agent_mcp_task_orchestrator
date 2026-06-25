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

- **📋 Task Management** — Create, update, track tasks with rich metadata
- **🔗 Smart Dependencies** — Positional + ID-based dependencies, soft dependencies, timeouts
- **🏗️ Hierarchical Support** — Parent tasks with subtasks (LLM-friendly hierarchy)
- **� Workflow Orchestration** — Group tasks into named workflows with automatic progression
- **⏱️ Execution Tracking** — Start/complete times, durations, retries
- **� Persistent Storage** — JSON or SQLite backend
- **🧹 Cleanup Tools** — Handle orphaned, duplicate, or stale tasks (common with LLM usage)
- **� Statistics & Logging** — Full visibility into agent activity

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

### 3. Session Grouping
Always include `sessionId` for related tasks:
- `"feature-auth-2024"`
- `"bugfix-payment-123"`

### 4. Let the Orchestrator Handle Order
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
{ "name": "Build User Dashboard", "sessionId": "dashboard-2024" }

// 2. Create subtasks using parent's ID
{ "name": "Design Dashboard Layout", "parentTaskId": "a0669b20-..." }

// 3. Mark parent in_progress, then work on subtasks freely
// 4. Complete subtasks → parent can be completed
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
  - `dependencies` (optional): Array of task IDs or positional references (task-1, task-2...) that this task depends on
  - `parentTaskId` (optional): Parent task ID for creating subtasks. **CRITICAL: Must be an actual existing task ID, NOT a positional reference.** Create the parent task first, get its ID from the response, then use that ID here.
  - `sessionId` (optional): Session ID for grouping related tasks (top-level field, e.g., "feature-auth")
  - `metadata` (optional): Additional metadata for the task
  - `maxRetries` (optional): Maximum number of retry attempts for this task
  - `deduplication` (optional): How to handle duplicate tasks (skip, reuse, error, none)

**Important Notes:**
- Positional references (task-1, task-2, etc.) ONLY work for dependencies within the same batch
- For parentTaskId, you MUST use actual existing task IDs - create the parent task first, get its ID from the response, then create subtasks using that ID
- Do not use positional references for parentTaskId

### `update_task`
Update an existing task.

**Parameters:**
- `id` (required): The ID of the task to update
- `name` (optional): New name for the task
- `description` (optional): New description
- `dependencies` (optional): New dependencies
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

### `execute_task`
Mark a task as completed with a result.

**Parameters:**
- `id` (required): The ID of the task to execute
- `result` (optional): The result of the task execution

### `fail_task`
Mark a task as failed with an error message.

**Parameters:**
- `id` (required): The ID of the task to fail
- `error` (required): The error message

### `mark_in_progress`
Mark a task as in progress.

**Parameters:**
- `id` (required): The ID of the task to mark as in progress

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

2. **Create dependent tasks:**
```json
{
  "name": "Run tests",
  "dependencies": ["task_1234567890_abc"]
}
```

3. **Check which tasks can be executed:** (Use `get_next_tasks` tool)

4. **Execute a task:**
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
- `sessionId`: Session ID if available

**LLM Response Logs** (for debugging LLM → Agent interactions):
- `timestamp`: When the LLM response was logged
- `type`: "llm_response"
- `content`: Full text from LLM that suggested tool calls
- `toolCalls`: Array of tool calls suggested by the LLM
- `relatedTools`: List of tool names extracted from tool calls
- `sessionId`: Session ID if available

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
  toolCalls,
  { sessionId: "feature-auth" }
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
