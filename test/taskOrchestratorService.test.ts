import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { TaskOrchestratorService } from '../src/taskOrchestratorService.js';
import { resetConfigManager } from '../src/config.js';
import { TASK_STATUS } from '../src/constants.js';
import type { Task } from '../src/types.js';
import { StorageFactory } from '../src/storage/StorageFactory.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_JSON_STORAGE_PATH = path.join(__dirname, 'test-storage.json');
const TEST_SQLITE_STORAGE_PATH = path.join(__dirname, 'test-storage.db');

const testCases = [
  { name: 'JSON Storage', backend: 'json' as const, path: TEST_JSON_STORAGE_PATH },
  { name: 'SQLite Storage', backend: 'sqlite' as const, path: TEST_SQLITE_STORAGE_PATH }
];

for (const testCase of testCases) {
  describe(`TaskOrchestratorService with ${testCase.name}`, () => {
    let service: TaskOrchestratorService;
    let storageAdapter: any;

    beforeEach(async () => {
      resetConfigManager();
      // Disable auto-save during tests to avoid race conditions with cleanup
      process.env.TASK_ORCHESTRATOR_AUTO_SAVE = 'false';
      storageAdapter = StorageFactory.createAdapter(testCase.backend, testCase.path);
      await storageAdapter.initialize();
      service = new TaskOrchestratorService(storageAdapter);
      await service.load();
    });

    afterEach(async () => {
      await service.forceSave(); // Ensure all pending saves complete
      await service.shutdown();
      await service.clearAll();
      await storageAdapter.close();
      try {
        await fs.unlink(testCase.path);
      } catch {
        // File might not exist
      }
    });

    describe('createTask', () => {
      it('should create a task with required fields', () => {
        const task = service.createTask({
          name: 'Test Task'
        });

        assert.strictEqual(task.name, 'Test Task');
        assert.strictEqual(task.status, TASK_STATUS.PENDING);
        assert.strictEqual(task.dependencies.length, 0);
        assert.ok(task.id);
        assert.ok(task.createdAt);
        assert.ok(task.updatedAt);
      });

      it('should create a task with optional fields', () => {
        const task = service.createTask({
          name: 'Test Task',
          description: 'Test description',
          dependencies: [],
          metadata: { key: 'value' }
        });

        assert.strictEqual(task.description, 'Test description');
        assert.deepStrictEqual(task.metadata, { key: 'value' });
      });

      it('should generate unique IDs for different tasks', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ name: 'Task 2' });

        assert.notStrictEqual(task1.id, task2.id);
      });

      it('should create a task with a parent task', () => {
        const parentTask = service.createTask({ name: 'Parent Task' });
        const childTask = service.createTask({
          name: 'Child Task',
          parentTaskId: parentTask.id
        });

        assert.strictEqual(childTask.parentTaskId, parentTask.id);
      });

      it('should throw error when parent task does not exist', () => {
        assert.throws(() => {
          service.createTask({
            name: 'Child Task',
            parentTaskId: 'non-existent-parent-id'
          });
        });
      });
    });

    describe('createTasks', () => {
      it('should create a single task using batch method', () => {
        const tasks = service.createTasks([
          { name: 'Test Task' }
        ]);

        assert.strictEqual(tasks.length, 1);
        assert.strictEqual(tasks[0].name, 'Test Task');
        assert.strictEqual(tasks[0].status, TASK_STATUS.PENDING);
        assert.ok(tasks[0].id);
        assert.ok(tasks[0].createdAt);
        assert.ok(tasks[0].updatedAt);
      });

      it('should create multiple tasks in one call', () => {
        const tasks = service.createTasks([
          { name: 'Task 1' },
          { name: 'Task 2' },
          { name: 'Task 3' }
        ]);

        assert.strictEqual(tasks.length, 3);
        assert.strictEqual(tasks[0].name, 'Task 1');
        assert.strictEqual(tasks[1].name, 'Task 2');
        assert.strictEqual(tasks[2].name, 'Task 3');
      });

      it('should generate unique IDs for each task in batch', () => {
        const tasks = service.createTasks([
          { name: 'Task 1' },
          { name: 'Task 2' }
        ]);

        assert.notStrictEqual(tasks[0].id, tasks[1].id);
      });

      it('should create tasks with optional fields in batch', () => {
        const tasks = service.createTasks([
          { name: 'Task 1', description: 'Description 1' },
          { name: 'Task 2', metadata: { key: 'value' } }
        ]);

        assert.strictEqual(tasks[0].description, 'Description 1');
        assert.deepStrictEqual(tasks[1].metadata, { key: 'value' });
      });

      it('should create tasks with dependencies in batch', () => {
        const parentTask = service.createTask({ name: 'Parent Task' });
        const tasks = service.createTasks([
          { name: 'Child 1', parentTaskId: parentTask.id },
          { name: 'Child 2', parentTaskId: parentTask.id }
        ]);

        assert.strictEqual(tasks.length, 2);
        assert.strictEqual(tasks[0].parentTaskId, parentTask.id);
        assert.strictEqual(tasks[1].parentTaskId, parentTask.id);
      });

      it('should throw error when dependency does not exist in batch', () => {
        assert.throws(() => {
          service.createTasks([
            { name: 'Task 1', dependencies: ['non-existent-id'] }
          ]);
        });
      });

      it('should throw error when parent task does not exist in batch', () => {
        assert.throws(() => {
          service.createTasks([
            { name: 'Child Task', parentTaskId: 'non-existent-parent-id' }
          ]);
        });
      });

      it('should resolve name-based dependencies within the same batch (forward reference)', () => {
        const tasks = [
          { name: 'Task A', dependencies: ['Task B'] },
          { name: 'Task B' }
        ];

        const created = service.createTasks(tasks);
        assert.strictEqual(created.length, 2);
        assert.strictEqual(created[0].dependencies.length, 1);
        assert.strictEqual(created[0].dependencies[0], created[1].id);
      });

      it('should support UUID-based dependencies referencing existing tasks', () => {
        const existingTask = service.createTask({ name: 'Existing Task' });

        const tasks = [
          { name: 'Task A', dependencies: [existingTask.id] }
        ];

        const created = service.createTasks(tasks);
        assert.strictEqual(created.length, 1);
        assert.strictEqual(created[0].dependencies.length, 1);
        assert.strictEqual(created[0].dependencies[0], existingTask.id);
      });

      it('should throw error for dependencies that cannot be resolved by any method', () => {
        const tasks = [
          { name: 'Task A', dependencies: ['not-a-task-id'] }
        ];

        assert.throws(() => {
          service.createTasks(tasks);
        }, /could not be resolved/);
      });

      it('should resolve dependencies by task name within the same batch', () => {
        const tasks = [
          { name: 'Study codebase', description: 'Analyze the project structure' },
          { name: 'Explore improvements', description: 'Find improvement opportunities', dependencies: ['Study codebase'] },
          { name: 'Compile recommendations', description: 'Organize findings', dependencies: ['Explore improvements'] }
        ];

        const created = service.createTasks(tasks);
        assert.strictEqual(created.length, 3);
        assert.strictEqual(created[1].dependencies.length, 1);
        assert.strictEqual(created[1].dependencies[0], created[0].id);
        assert.strictEqual(created[2].dependencies.length, 1);
        assert.strictEqual(created[2].dependencies[0], created[1].id);
      });

      it('should resolve dependencies by task name case-insensitively within batch', () => {
        const tasks = [
          { name: 'Setup Environment' },
          { name: 'Run Tests', dependencies: ['setup environment'] }
        ];

        const created = service.createTasks(tasks);
        assert.strictEqual(created[1].dependencies[0], created[0].id);
      });

      it('should resolve dependencies by task name of existing tasks in the system', () => {
        const existing = service.createTask({ name: 'Pre-existing Task' });
        const tasks = [
          { name: 'New Task', dependencies: ['Pre-existing Task'] }
        ];

        const created = service.createTasks(tasks);
        assert.strictEqual(created[0].dependencies[0], existing.id);
      });

      it('should resolve positional dependencies (task-1, task-2, etc.)', () => {
        const tasks = [
          { name: 'Task A' },
          { name: 'Task B', dependencies: ['task-1'] },
          { name: 'Task C', dependencies: ['task-2'] }
        ];

        const created = service.createTasks(tasks);
        assert.strictEqual(created.length, 3);

        // Task B should depend on Task A (task-1)
        const taskB = created.find(t => t.name === 'Task B');
        assert.ok(taskB);
        assert.strictEqual(taskB?.dependencies.length, 1);
        assert.strictEqual(taskB?.dependencies[0], created[0].id);

        // Task C should depend on Task B (task-2)
        const taskC = created.find(t => t.name === 'Task C');
        assert.ok(taskC);
        assert.strictEqual(taskC?.dependencies.length, 1);
        assert.strictEqual(taskC?.dependencies[0], created[1].id);
      });

      it('should support multiple positional dependencies', () => {
        const tasks = [
          { name: 'Task A' },
          { name: 'Task B' },
          { name: 'Task C', dependencies: ['task-1', 'task-2'] }
        ];

        const created = service.createTasks(tasks);
        const taskC = created.find(t => t.name === 'Task C');

        assert.ok(taskC);
        assert.strictEqual(taskC?.dependencies.length, 2);
        assert.ok(taskC?.dependencies.includes(created[0].id));
        assert.ok(taskC?.dependencies.includes(created[1].id));
      });

      it('should throw error for out-of-range positional index', () => {
        const tasks = [
          { name: 'Task A' },
          { name: 'Task B', dependencies: ['task-5'] }
        ];

        assert.throws(() => {
          service.createTasks(tasks);
        }, /Positional dependency 'task-5' is out of range/);
      });

      it('should throw error for invalid positional index (zero)', () => {
        const tasks = [
          { name: 'Task A' },
          { name: 'Task B', dependencies: ['task-0'] }
        ];

        assert.throws(() => {
          service.createTasks(tasks);
        }, /Positional dependency 'task-0' is out of range/);
      });

      it('should detect circular dependencies with positional references', () => {
        const tasks = [
          { name: 'Task A', dependencies: ['task-2'] },
          { name: 'Task B', dependencies: ['task-1'] }
        ];

        assert.throws(() => {
          service.createTasks(tasks);
        }, /Circular dependency detected/);
      });

      it('should support complex DAG with positional dependencies', () => {
        const tasks = [
          { name: 'Task A' },
          { name: 'Task B' },
          { name: 'Task C', dependencies: ['task-1'] },
          { name: 'Task D', dependencies: ['task-2'] },
          { name: 'Task E', dependencies: ['task-3', 'task-4'] }
        ];

        const created = service.createTasks(tasks);
        const taskE = created.find(t => t.name === 'Task E');

        assert.ok(taskE);
        assert.strictEqual(taskE?.dependencies.length, 2);
        assert.ok(taskE?.dependencies.includes(created[2].id)); // Task C
        assert.ok(taskE?.dependencies.includes(created[3].id)); // Task D
      });

      it('should skip duplicate tasks when deduplication is skip', () => {
        service.createTasks([{ name: 'Task A' }]);

        const created = service.createTasks(
          [{ name: 'Task A' }],
          { defaultDeduplication: 'skip' }
        );

        assert.strictEqual(created.length, 1);
        assert.strictEqual(service.getAllTasks().filter(t => t.name === 'Task A').length, 1);
      });

      it('should error on duplicate tasks when deduplication is error', () => {
        service.createTasks([{ name: 'Task A' }]);

        assert.throws(() => {
          service.createTasks(
            [{ name: 'Task A' }],
            { defaultDeduplication: 'error' }
          );
        }, /Duplicate task detected/);
      });

      it('should create duplicates when deduplication is none', () => {
        service.createTasks([{ name: 'Task A' }]);

        const created = service.createTasks(
          [{ name: 'Task A' }],
          { defaultDeduplication: 'none' }
        );

        assert.strictEqual(created.length, 1);
        assert.strictEqual(service.getAllTasks().filter(t => t.name === 'Task A').length, 2);
      });
    });

    describe('updateTask', () => {
      it('should update an existing task', () => {
        const task = service.createTask({ name: 'Original Name' });
        const updated = service.updateTask(task.id, { name: 'Updated Name' });

        assert.ok(updated);
        assert.strictEqual(updated?.name, 'Updated Name');
      });

      it('should return null for non-existent task', () => {
        const result = service.updateTask('non-existent-id', { name: 'New Name' });
        assert.strictEqual(result, null);
      });

      it('should update updatedAt timestamp', async () => {
        const task = service.createTask({ name: 'Test Task' });
        const originalUpdatedAt = task.updatedAt;
        
        // Wait a bit to ensure timestamp difference
        await new Promise(resolve => setTimeout(resolve, 10));
        
        const updated = service.updateTask(task.id, { name: 'Updated' });
        assert.ok(updated);
        assert.notStrictEqual(updated?.updatedAt, originalUpdatedAt);
      });
    });

    describe('deleteTask', () => {
      it('should delete an existing task', () => {
        const task = service.createTask({ name: 'Test Task' });
        const deleted = service.deleteTask(task.id);

        assert.strictEqual(deleted, true);
        assert.strictEqual(service.getTask(task.id), undefined);
      });

      it('should return false for non-existent task', () => {
        const deleted = service.deleteTask('non-existent-id');
        assert.strictEqual(deleted, false);
      });
    });

    describe('getTask', () => {
      it('should retrieve an existing task', () => {
        const task = service.createTask({ name: 'Test Task' });
        const retrieved = service.getTask(task.id);

        assert.ok(retrieved);
        assert.strictEqual(retrieved?.id, task.id);
      });

      it('should return undefined for non-existent task', () => {
        const retrieved = service.getTask('non-existent-id');
        assert.strictEqual(retrieved, undefined);
      });
    });

    describe('getAllTasks', () => {
      it('should return all tasks', () => {
        service.createTask({ name: 'Task 1' });
        service.createTask({ name: 'Task 2' });
        service.createTask({ name: 'Task 3' });

        const tasks = service.getAllTasks();
        assert.strictEqual(tasks.length, 3);
      });

      it('should return empty array when no tasks exist', () => {
        const tasks = service.getAllTasks();
        assert.strictEqual(tasks.length, 0);
      });
    });

    describe('getTasksByStatus', () => {
      it('should filter tasks by status', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ name: 'Task 2' });
        
        service.executeTask(task1.id);
        
        const pendingTasks = service.getTasksByStatus(TASK_STATUS.PENDING);
        const completedTasks = service.getTasksByStatus(TASK_STATUS.COMPLETED);

        assert.strictEqual(pendingTasks.length, 1);
        assert.strictEqual(completedTasks.length, 1);
        assert.strictEqual(pendingTasks[0].id, task2.id);
        assert.strictEqual(completedTasks[0].id, task1.id);
      });
    });

    describe('executeTask', () => {
      it('should execute a task with no dependencies', () => {
        const task = service.createTask({ name: 'Test Task' });
        const executed = service.executeTask(task.id, { result: 'success' });

        assert.ok(executed);
        assert.strictEqual(executed?.status, TASK_STATUS.COMPLETED);
        assert.deepStrictEqual(executed?.result, { result: 'success' });
      });

      it('should execute task even with unmet dependencies', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ name: 'Task 2', dependencies: [task1.id] });

        const executed = service.executeTask(task2.id);
        assert.ok(executed);
        assert.strictEqual(executed?.status, TASK_STATUS.COMPLETED);
      });

      it('should execute task when dependencies are met', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ name: 'Task 2', dependencies: [task1.id] });

        service.executeTask(task1.id);
        const executed = service.executeTask(task2.id);

        assert.ok(executed);
        assert.strictEqual(executed?.status, TASK_STATUS.COMPLETED);
      });

      it('should execute task with complex result object regardless of dependencies', () => {
        // Create a task with dependencies
        const task1 = service.createTask({ name: 'Dependency Task' });
        const task2 = service.createTask({ 
          name: 'Main Task', 
          dependencies: [task1.id] 
        });

        // Execute task2 without completing task1 - should succeed (bypasses deps)
        const executedWithoutDeps = service.executeTask(task2.id, {
          improvements: [
            "Scene persistence (JSON/SQLite) - Priority: High",
            "Scene templates/presets - Priority: High"
          ]
        });
        assert.ok(executedWithoutDeps);
        assert.strictEqual(executedWithoutDeps?.status, TASK_STATUS.COMPLETED);
        assert.deepStrictEqual(executedWithoutDeps?.result, {
          improvements: [
            "Scene persistence (JSON/SQLite) - Priority: High",
            "Scene templates/presets - Priority: High"
          ]
        });

        // Verify canExecute still returns false with reason (check still works)
        const canExecute = service.canExecuteTask(task2.id);
        assert.strictEqual(canExecute.canExecute, false);
        assert.ok(canExecute.reason);
      });

      it('should not complete parent while subtasks are incomplete', () => {
        const parentTask = service.createTask({ name: 'Parent Task' });
        const subtask1 = service.createTask({ name: 'Subtask 1', parentTaskId: parentTask.id });
        const subtask2 = service.createTask({ name: 'Subtask 2', parentTaskId: parentTask.id });

        // Try to complete parent while subtasks are still pending - should fail
        const executed = service.executeTask(parentTask.id);
        assert.strictEqual(executed, null);

        // Complete one subtask
        service.executeTask(subtask1.id);

        // Parent still cannot complete (one subtask still incomplete)
        const executedAfterOne = service.executeTask(parentTask.id);
        assert.strictEqual(executedAfterOne, null);

        // Complete second subtask
        service.executeTask(subtask2.id);

        // Now parent can complete
        const executedAfterAll = service.executeTask(parentTask.id);
        assert.ok(executedAfterAll);
        assert.strictEqual(executedAfterAll?.status, TASK_STATUS.COMPLETED);
      });

      it('should allow parent to complete after all subtasks are completed', () => {
        const parentTask = service.createTask({ name: 'Parent Task' });
        const subtask = service.createTask({ name: 'Subtask', parentTaskId: parentTask.id });

        // Complete subtask first
        service.executeTask(subtask.id);

        // Parent should now be able to complete
        const executed = service.executeTask(parentTask.id);
        assert.ok(executed);
        assert.strictEqual(executed?.status, TASK_STATUS.COMPLETED);
      });

      it('should allow parent to complete after all subtasks are failed', () => {
        const parentTask = service.createTask({ name: 'Parent Task' });
        const subtask = service.createTask({ name: 'Subtask', parentTaskId: parentTask.id });

        // Fail subtask
        service.failTask(subtask.id, 'Subtask failed');

        // Parent should now be able to complete (subtask is failed, not incomplete)
        const executed = service.executeTask(parentTask.id);
        assert.ok(executed);
        assert.strictEqual(executed?.status, TASK_STATUS.COMPLETED);
      });
    });

    describe('failTask', () => {
      it('should mark a task as failed', () => {
        const task = service.createTask({ name: 'Test Task' });
        const failed = service.failTask(task.id, 'Test error');

        assert.ok(failed);
        assert.strictEqual(failed?.status, TASK_STATUS.FAILED);
        assert.strictEqual(failed?.error, 'Test error');
      });

      it('should return null for non-existent task', () => {
        const failed = service.failTask('non-existent-id', 'Error');
        assert.strictEqual(failed, null);
      });

      it('should not fail parent while subtasks are incomplete', () => {
        const parentTask = service.createTask({ name: 'Parent Task' });
        const subtask = service.createTask({ name: 'Subtask', parentTaskId: parentTask.id });

        // Try to fail parent while subtask is still pending - should fail
        const failed = service.failTask(parentTask.id, 'Parent failed');
        assert.strictEqual(failed, null);

        // Complete subtask
        service.executeTask(subtask.id);

        // Now parent can fail
        const failedAfterSubtask = service.failTask(parentTask.id, 'Parent failed');
        assert.ok(failedAfterSubtask);
        assert.strictEqual(failedAfterSubtask?.status, TASK_STATUS.FAILED);
      });
    });

    describe('markTaskInProgress', () => {
      it('should mark a task as in progress', () => {
        const task = service.createTask({ name: 'Test Task' });
        const inProgress = service.markTaskInProgress(task.id);

        assert.ok(inProgress);
        assert.strictEqual(inProgress?.status, TASK_STATUS.IN_PROGRESS);
      });

      it('should not mark task with unmet dependencies', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ name: 'Task 2', dependencies: [task1.id] });

        const inProgress = service.markTaskInProgress(task2.id);
        assert.strictEqual(inProgress, null);
      });

      it('should allow subtask to start while parent is in progress', () => {
        // Subtasks can now start independently of parent status
        const parentTask = service.createTask({ name: 'Parent Task' });
        const subtask = service.createTask({ name: 'Subtask', parentTaskId: parentTask.id });

        // Mark parent as in progress
        const parentInProgress = service.markTaskInProgress(parentTask.id);
        assert.ok(parentInProgress);
        assert.strictEqual(parentInProgress?.status, TASK_STATUS.IN_PROGRESS);

        // Subtask should now be able to start even while parent is in progress
        const subtaskInProgress = service.markTaskInProgress(subtask.id);
        assert.ok(subtaskInProgress);
        assert.strictEqual(subtaskInProgress?.status, TASK_STATUS.IN_PROGRESS);

        // Verify subtask does NOT have parent in dependencies
        assert.ok(!subtask.dependencies.includes(parentTask.id));
      });

      it('should allow subtask to start even if parent is pending', () => {
        const parentTask = service.createTask({ name: 'Parent Task' });
        const subtask = service.createTask({ name: 'Subtask', parentTaskId: parentTask.id });

        // Subtask should be able to start even while parent is still pending
        const subtaskInProgress = service.markTaskInProgress(subtask.id);
        assert.ok(subtaskInProgress);
        assert.strictEqual(subtaskInProgress?.status, TASK_STATUS.IN_PROGRESS);
      });

      it('should NOT auto-add parent to dependencies when creating subtask', () => {
        const parentTask = service.createTask({ name: 'Parent Task' });
        const subtask = service.createTask({ name: 'Subtask', parentTaskId: parentTask.id });

        // Verify subtask does NOT have parent in its dependencies
        assert.ok(!subtask.dependencies.includes(parentTask.id));
      });
    });

    describe('resetTask', () => {
      it('should reset a completed task to pending', () => {
        const task = service.createTask({ name: 'Test Task' });
        service.executeTask(task.id, { result: 'success' });

        const reset = service.resetTask(task.id);
        assert.ok(reset);
        assert.strictEqual(reset?.status, TASK_STATUS.PENDING);
        assert.strictEqual(reset?.result, undefined);
      });

      it('should reset a failed task to pending', () => {
        const task = service.createTask({ name: 'Test Task' });
        service.failTask(task.id, 'Error');

        const reset = service.resetTask(task.id);
        assert.ok(reset);
        assert.strictEqual(reset?.status, TASK_STATUS.PENDING);
        assert.strictEqual(reset?.error, undefined);
      });
    });

    describe('canExecuteTask', () => {
      it('should return true for task with no dependencies', () => {
        const task = service.createTask({ name: 'Test Task' });
        const check = service.canExecuteTask(task.id);

        assert.strictEqual(check.canExecute, true);
      });

      it('should return false for task with unmet dependencies', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ name: 'Task 2', dependencies: [task1.id] });

        const check = service.canExecuteTask(task2.id);
        assert.strictEqual(check.canExecute, false);
        assert.ok(check.reason);
      });

      it('should return true when dependencies are met', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ name: 'Task 2', dependencies: [task1.id] });

        service.executeTask(task1.id);
        const check = service.canExecuteTask(task2.id);

        assert.strictEqual(check.canExecute, true);
      });

      it('should return false for non-existent task', () => {
        const check = service.canExecuteTask('non-existent-id');
        assert.strictEqual(check.canExecute, false);
        assert.strictEqual(check.reason, 'Task not found');
      });

      it('should allow execution with unmet soft dependencies', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ 
          name: 'Task 2', 
          softDependencies: [task1.id] 
        });

        const check = service.canExecuteTask(task2.id);
        assert.strictEqual(check.canExecute, true);
        assert.ok(check.reason?.includes('Soft dependencies not met'));
      });

      it('should execute task with unmet soft dependencies', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ 
          name: 'Task 2', 
          softDependencies: [task1.id] 
        });

        const executed = service.executeTask(task2.id);
        assert.ok(executed);
        assert.strictEqual(executed?.status, TASK_STATUS.COMPLETED);
      });

      it('should allow execution when dependency timeout is exceeded', async () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ 
          name: 'Task 2', 
          dependencies: [task1.id],
          dependencyTimeouts: { [task1.id]: 100 } // 100ms timeout
        });

        // Wait for timeout to exceed
        await new Promise(resolve => setTimeout(resolve, 150));

        const check = service.canExecuteTask(task2.id);
        assert.strictEqual(check.canExecute, true);
      });

      it('should block execution when dependency timeout not exceeded', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({
          name: 'Task 2',
          dependencies: [task1.id],
          dependencyTimeouts: { [task1.id]: 10000 } // 10s timeout
        });

        const check = service.canExecuteTask(task2.id);
        assert.strictEqual(check.canExecute, false);
        assert.ok(check.reason?.includes('Dependency'));
      });

      it('should skip conditional dependency when condition is false', () => {
        const task1 = service.createTask({
          name: 'Task 1',
          metadata: { environment: 'production' }
        });
        const task2 = service.createTask({
          name: 'Task 2',
          conditionalDependencies: [
            { condition: `task.${task1.id}.metadata.environment == "staging"`, taskId: task1.id }
          ]
        });

        const check = service.canExecuteTask(task2.id);
        assert.strictEqual(check.canExecute, true);
      });

      it('should require conditional dependency when condition is true', () => {
        const task1 = service.createTask({
          name: 'Task 1',
          metadata: { environment: 'production' }
        });
        const task2 = service.createTask({
          name: 'Task 2',
          conditionalDependencies: [
            { condition: 'true', taskId: task1.id }
          ]
        });

        const check = service.canExecuteTask(task2.id);
        assert.strictEqual(check.canExecute, false);
        assert.ok(check.reason?.includes('Conditional dependency'));
      });

      it('should allow execution when conditional dependency is met', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({
          name: 'Task 2',
          conditionalDependencies: [
            { condition: 'true', taskId: task1.id }
          ]
        });

        service.executeTask(task1.id);
        const check = service.canExecuteTask(task2.id);
        assert.strictEqual(check.canExecute, true);
      });

      it('should evaluate boolean condition correctly', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({
          name: 'Task 2',
          conditionalDependencies: [
            { condition: 'false', taskId: task1.id }
          ]
        });

        const check = service.canExecuteTask(task2.id);
        assert.strictEqual(check.canExecute, true); // Condition is false, so dependency not required
      });

      it('should skip external dependencies in synchronous check', () => {
        const task = service.createTask({
          name: 'Task with External Dep',
          externalDependencies: [
            { type: 'api', url: 'https://nonexistent.example.com', timeoutMs: 1000 }
          ]
        });

        // Synchronous check should skip external dependencies
        const check = service.canExecuteTask(task.id);
        assert.strictEqual(check.canExecute, true);
      });

      it('should fail when external dependency is unavailable', async () => {
        const task = service.createTask({
          name: 'Task with Bad External Dep',
          externalDependencies: [
            { type: 'api', url: 'https://nonexistent.example.com', timeoutMs: 1000 }
          ]
        });

        const check = await service.canExecuteTaskWithExternalChecks(task.id);
        assert.strictEqual(check.canExecute, false);
        assert.ok(check.reason?.includes('not available'));
      });
    });

    describe('getNextExecutableTasks', () => {
      it('should return tasks with no dependencies', () => {
        service.createTask({ name: 'Task 1' });
        service.createTask({ name: 'Task 2' });

        const executable = service.getNextExecutableTasks();
        assert.strictEqual(executable.length, 2);
      });

      it('should not return tasks with unmet dependencies', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        service.createTask({ name: 'Task 2', dependencies: [task1.id] });

        const executable = service.getNextExecutableTasks();
        assert.strictEqual(executable.length, 1);
        assert.strictEqual(executable[0].id, task1.id);
      });
    });

    describe('workflows', () => {
      it('should create a workflow', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ name: 'Task 2' });

        const workflow = service.createWorkflow('Test Workflow', [task1.id, task2.id]);
        assert.ok(workflow);

        const retrievedWorkflow = service.getWorkflow(workflow.id);
        assert.ok(retrievedWorkflow);
        assert.strictEqual(retrievedWorkflow?.taskIds.length, 2);
      });

      it('should get all workflows', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ name: 'Task 2' });

        service.createWorkflow('Workflow 1', [task1.id]);
        service.createWorkflow('Workflow 2', [task2.id]);

        const workflows = service.getAllWorkflows();
        assert.strictEqual(Object.keys(workflows).length, 2);
      });

      it('should delete a workflow', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const workflow = service.createWorkflow('Test Workflow', [task1.id]);

        const deleted = service.deleteWorkflow(workflow.id);
        assert.strictEqual(deleted, true);

        const retrievedWorkflow = service.getWorkflow(workflow.id);
        assert.strictEqual(retrievedWorkflow, undefined);
      });
    });

    describe('advanceWorkflowRun', () => {
      it('should return detailed information about workflow advancement', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ name: 'Task 2', dependencies: [task1.id] });
        const workflow = service.createWorkflow('Test Workflow', [task1.id, task2.id]);

        const startResult = service.startWorkflowExecution(workflow.id);
        assert.ok(startResult);
        assert.strictEqual(startResult.readyTasks.length, 1);

        // Complete task 1 by updating its status directly (simulating external completion)
        service.updateTask(task1.id, { status: 'completed', completedAt: new Date().toISOString() });

        // Advance workflow
        const advanceResult = service.advanceWorkflowRun(startResult.runId);
        assert.ok(advanceResult);
        // completedTasks returns all completed tasks in workflow (including task1)
        assert.strictEqual(advanceResult.completedTasks.length, 1);
        assert.strictEqual(advanceResult.failedTasks.length, 0);
        assert.strictEqual(advanceResult.newlyReadyTasks.length, 1);
        assert.strictEqual(advanceResult.workflowStatus, 'in_progress');
        assert.ok(advanceResult.message);
      });

      it('should detect manually completed tasks', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ name: 'Task 2', dependencies: [task1.id] });
        const workflow = service.createWorkflow('Test Workflow', [task1.id, task2.id]);

        const startResult = service.startWorkflowExecution(workflow.id);
        assert.ok(startResult);
        
        // Manually complete task 1 outside of workflow by updating status directly
        service.updateTask(task1.id, { status: 'completed', completedAt: new Date().toISOString() });

        // Advance should detect the manual completion
        const advanceResult = service.advanceWorkflowRun(startResult.runId);
        assert.ok(advanceResult);
        // completedTasks returns all completed tasks in workflow
        assert.strictEqual(advanceResult.completedTasks.length, 1);
        assert.strictEqual(advanceResult.newlyReadyTasks.length, 1);
      });

      it('should detect manually failed tasks', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ name: 'Task 2', dependencies: [task1.id] });
        const workflow = service.createWorkflow('Test Workflow', [task1.id, task2.id]);

        const startResult = service.startWorkflowExecution(workflow.id);
        assert.ok(startResult);
        
        // Manually fail task 1 outside of workflow
        service.failTask(task1.id, 'Manual failure');

        // Advance should detect the failure
        const advanceResult = service.advanceWorkflowRun(startResult.runId);
        assert.ok(advanceResult);
        assert.strictEqual(advanceResult.failedTasks.length, 1);
        assert.strictEqual(advanceResult.workflowStatus, 'failed');
      });

      it('should only fail workflow when no paths forward remain', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ name: 'Task 2', dependencies: [task1.id] });
        const task3 = service.createTask({ name: 'Task 3' }); // Independent task
        const workflow = service.createWorkflow('Test Workflow', [task1.id, task2.id, task3.id]);

        const startResult = service.startWorkflowExecution(workflow.id);
        assert.ok(startResult);
        
        // Fail task 1 by updating status directly (simulating external failure)
        service.updateTask(task1.id, { status: 'failed', error: 'Task 1 failed', completedAt: new Date().toISOString() });

        const advanceResult = service.advanceWorkflowRun(startResult.runId);
        assert.ok(advanceResult);
        // Workflow should not fail because task 3 can still run
        // Note: Since task 1 was active and failed, and task 3 is independent, 
        // the workflow should continue with task 3
        assert.strictEqual(advanceResult.workflowStatus, 'in_progress');
        assert.strictEqual(advanceResult.failedTasks.length, 1);
        // task3 was already started as in_progress during workflow start (no deps),
        // so it is not "newly" ready — it was ready from the beginning
        assert.strictEqual(advanceResult.newlyReadyTasks.length, 0);
        // Verify task3 is still active in the workflow run
        assert.ok(advanceResult.run.activeTaskIds.includes(task3.id));
      });

      it('should fail workflow when all paths are blocked', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ name: 'Task 2', dependencies: [task1.id] });
        const workflow = service.createWorkflow('Test Workflow', [task1.id, task2.id]);

        const startResult = service.startWorkflowExecution(workflow.id);
        assert.ok(startResult);
        
        // Fail task 1, blocking task 2
        service.failTask(task1.id, 'Task 1 failed');

        const advanceResult = service.advanceWorkflowRun(startResult.runId);
        assert.ok(advanceResult);
        assert.strictEqual(advanceResult.workflowStatus, 'failed');
        assert.strictEqual(advanceResult.failedTasks.length, 1);
        assert.strictEqual(advanceResult.blockedTasks.length, 1);
      });

      it('should include blocked tasks in return value', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ name: 'Task 2', dependencies: [task1.id] });
        const workflow = service.createWorkflow('Test Workflow', [task1.id, task2.id]);

        const startResult = service.startWorkflowExecution(workflow.id);
        assert.ok(startResult);
        
        const advanceResult = service.advanceWorkflowRun(startResult.runId);
        assert.ok(advanceResult);
        assert.strictEqual(advanceResult.blockedTasks.length, 1);
        assert.strictEqual(advanceResult.blockedTasks[0].id, task2.id);
      });

      it('should return human-readable message', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ name: 'Task 2', dependencies: [task1.id] });
        const workflow = service.createWorkflow('Test Workflow', [task1.id, task2.id]);

        const startResult = service.startWorkflowExecution(workflow.id);
        assert.ok(startResult);
        service.executeTask(task1.id);

        const advanceResult = service.advanceWorkflowRun(startResult.runId);
        assert.ok(advanceResult);
        assert.ok(advanceResult.message);
        assert.ok(advanceResult.message.includes('tasks completed'));
        assert.ok(advanceResult.message.includes('new tasks ready'));
      });
    });

    describe('getStats', () => {
      it('should return correct statistics', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ name: 'Task 2' });
        const task3 = service.createTask({ name: 'Task 3' });

        service.executeTask(task1.id);
        service.failTask(task2.id, 'Error');
        service.markTaskInProgress(task3.id);

        const stats = service.getStats();
        assert.strictEqual(stats.totalTasks, 3);
        assert.strictEqual(stats.pending, 0);
        assert.strictEqual(stats.inProgress, 1);
        assert.strictEqual(stats.completed, 1);
        assert.strictEqual(stats.failed, 1);
      });

      it('should return zero stats when no tasks exist', () => {
        const stats = service.getStats();
        assert.strictEqual(stats.totalTasks, 0);
        assert.strictEqual(stats.pending, 0);
        assert.strictEqual(stats.inProgress, 0);
        assert.strictEqual(stats.completed, 0);
        assert.strictEqual(stats.failed, 0);
      });
    });

    describe('persistence', () => {
      it('should save and load state', async () => {
        const task = service.createTask({ name: 'Test Task' });
        await service.save();

        const newStorageAdapter = StorageFactory.createAdapter(testCase.backend, testCase.path);
        await newStorageAdapter.initialize();
        const newService = new TaskOrchestratorService(newStorageAdapter);
        await newService.load();

        const loadedTask = newService.getTask(task.id);
        assert.ok(loadedTask);
        assert.strictEqual(loadedTask?.name, 'Test Task');
        assert.strictEqual(loadedTask?.id, task.id);
        
        await newStorageAdapter.close();
      });

      it('should preserve all JSON-compatible fields on save/load', async () => {
        const depTask = service.createTask({ name: 'Dependency Task' });
        const task = service.createTask({
          name: 'Full Task',
          description: 'Task with all optional fields',
          dependencies: [depTask.id],
          softDependencies: [depTask.id],
          dependencyTimeouts: { [depTask.id]: 5000 },
          externalDependencies: [{ type: 'api', url: 'https://example.com/health', timeoutMs: 1000 }],
          conditionalDependencies: [{ condition: 'true', taskId: depTask.id }],
          metadata: { environment: 'test', tags: ['a', 'b'] },
        });
        service.executeTask(task.id, { outcome: 'success', details: [1, 2, 3] });
        await service.save();

        const newStorageAdapter = StorageFactory.createAdapter(testCase.backend, testCase.path);
        await newStorageAdapter.initialize();
        const newService = new TaskOrchestratorService(newStorageAdapter);
        await newService.load();

        const loadedTask = newService.getTask(task.id);
        assert.ok(loadedTask);
        assert.strictEqual(loadedTask?.name, 'Full Task');
        assert.strictEqual(loadedTask?.description, 'Task with all optional fields');
        assert.deepStrictEqual(loadedTask?.dependencies, [depTask.id]);
        assert.deepStrictEqual(loadedTask?.softDependencies, [depTask.id]);
        assert.deepStrictEqual(loadedTask?.dependencyTimeouts, { [depTask.id]: 5000 });
        assert.deepStrictEqual(loadedTask?.externalDependencies, [{ type: 'api', url: 'https://example.com/health', timeoutMs: 1000 }]);
        assert.deepStrictEqual(loadedTask?.conditionalDependencies, [{ condition: 'true', taskId: depTask.id }]);
        assert.deepStrictEqual(loadedTask?.metadata, { environment: 'test', tags: ['a', 'b'] });
        assert.deepStrictEqual(loadedTask?.result, { outcome: 'success', details: [1, 2, 3] });

        await newStorageAdapter.close();
      });
    });

    describe('subtasks', () => {
      it('should get subtasks of a parent task', () => {
        const parentTask = service.createTask({ name: 'Parent Task' });
        const child1 = service.createTask({ name: 'Child 1', parentTaskId: parentTask.id });
        const child2 = service.createTask({ name: 'Child 2', parentTaskId: parentTask.id });
        const unrelatedTask = service.createTask({ name: 'Unrelated Task' });

        const subtasks = service.getSubtasks(parentTask.id);
        assert.strictEqual(subtasks.length, 2);
        assert.ok(subtasks.some(t => t.id === child1.id));
        assert.ok(subtasks.some(t => t.id === child2.id));
        assert.ok(!subtasks.some(t => t.id === unrelatedTask.id));
      });

      it('should return empty array for task with no subtasks', () => {
        const task = service.createTask({ name: 'Task with no children' });
        const subtasks = service.getSubtasks(task.id);
        assert.strictEqual(subtasks.length, 0);
      });

      it('should get task with its subtasks', () => {
        const parentTask = service.createTask({ name: 'Parent Task' });
        const child1 = service.createTask({ name: 'Child 1', parentTaskId: parentTask.id });
        const child2 = service.createTask({ name: 'Child 2', parentTaskId: parentTask.id });

        const result = service.getTaskWithSubtasks(parentTask.id);
        assert.strictEqual(result.task.id, parentTask.id);
        assert.strictEqual(result.subtasks.length, 2);
        assert.ok(result.subtasks.some(t => t.id === child1.id));
        assert.ok(result.subtasks.some(t => t.id === child2.id));
      });

      it('should throw error when getting subtasks of non-existent task', () => {
        assert.throws(() => {
          service.getTaskWithSubtasks('non-existent-id');
        });
      });
    });

    describe('cleanupTasks', () => {
      it('should detect orphaned subtasks without deleting by default', () => {
        const parent = service.createTask({ name: 'Parent' });
        const child = service.createTask({ name: 'Child', parentTaskId: parent.id });
        service.deleteTask(parent.id);

        const result = service.cleanupTasks();
        assert.strictEqual(result.orphanedSubtasks, 1);
        assert.strictEqual(result.deleted, 0);
        assert.ok(service.getTask(child.id));
      });

      it('should delete orphaned subtasks when deleteOrphans is true', () => {
        const parent = service.createTask({ name: 'Parent' });
        const child = service.createTask({ name: 'Child', parentTaskId: parent.id });
        service.deleteTask(parent.id);

        const result = service.cleanupTasks({ deleteOrphans: true });
        assert.strictEqual(result.orphanedSubtasks, 1);
        assert.strictEqual(result.deleted, 1);
        assert.strictEqual(service.getTask(child.id), undefined);
      });

      it('should detect duplicate tasks', () => {
        service.createTask({ name: 'Dup' });
        service.createTask({ name: 'Dup' });

        const result = service.cleanupTasks();
        assert.strictEqual(result.duplicateTasks, 1);
        assert.strictEqual(result.deleted, 0);
      });

      it('should delete duplicate tasks keeping oldest', () => {
        const first = service.createTask({ name: 'Dup' });
        service.createTask({ name: 'Dup' });

        const result = service.cleanupTasks({ deleteDuplicates: true });
        assert.strictEqual(result.duplicateTasks, 1);
        assert.strictEqual(result.deleted, 1);
        assert.ok(service.getTask(first.id));
        assert.strictEqual(service.getAllTasks().filter(t => t.name === 'Dup').length, 1);
      });

      it('should not detect parent-completed pending subtasks (new behavior)', () => {
        // With new behavior, parents cannot complete while subtasks are pending
        const parent = service.createTask({ name: 'Parent' });
        const child = service.createTask({ name: 'Child', parentTaskId: parent.id });
        
        // Try to complete parent - should fail due to incomplete subtask
        const executed = service.executeTask(parent.id);
        assert.strictEqual(executed, null);

        const result = service.cleanupTasks();
        // No parent-completed subtasks since parent cannot complete
        assert.strictEqual(result.parentCompleted, 0);
      });

      it('should detect parent-completed only after subtasks complete', () => {
        const parent = service.createTask({ name: 'Parent' });
        const child = service.createTask({ name: 'Child', parentTaskId: parent.id });
        
        // Complete subtask first
        service.executeTask(child.id);
        
        // Now parent can complete
        service.executeTask(parent.id);

        const result = service.cleanupTasks();
        // Parent is completed, but subtask is also completed (not pending)
        assert.strictEqual(result.parentCompleted, 0);
      });

      it('should count stale pending tasks', async () => {
        const task = service.createTask({ name: 'Stale' });
        // Manually set createdAt to old time
        service.updateTask(task.id, { createdAt: new Date(Date.now() - 100000).toISOString() });

        const result = service.cleanupTasks({ deleteStalePending: true, stalePendingMs: 1000 });
        assert.strictEqual(result.stalePendingTasks, 1);
        assert.strictEqual(result.deleted, 1);
      });
    });

    describe('Intelligent Scheduling - Readiness Scoring', () => {
      it('should return readinessScore and readinessBreakdown for executable task', () => {
        const task = service.createTask({ name: 'Test Task', priority: 80 });
        const check = service.canExecuteTask(task.id);

        assert.strictEqual(check.canExecute, true);
        assert.ok(check.readinessScore !== undefined);
        assert.ok(check.readinessBreakdown !== undefined);
        assert.ok(check.readinessBreakdown!.hardDepsSatisfied >= 0);
        assert.ok(check.readinessBreakdown!.softDepsSatisfied >= 0);
        assert.ok(check.readinessBreakdown!.taskPriority >= 0);
        assert.ok(check.readinessBreakdown!.priorityBoost >= -10);
      });

      it('should give full hard deps points when no dependencies exist', () => {
        const task = service.createTask({ name: 'Test Task' });
        const check = service.canExecuteTask(task.id);

        assert.strictEqual(check.canExecute, true);
        assert.strictEqual(check.readinessBreakdown?.hardDepsSatisfied, 60);
      });

      it('should give full hard deps points when all hard dependencies are completed', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ 
          name: 'Task 2', 
          dependencies: [{ taskId: task1.id, type: 'hard' }] 
        });

        service.executeTask(task1.id);
        const check = service.canExecuteTask(task2.id);

        assert.strictEqual(check.canExecute, true);
        assert.strictEqual(check.readinessBreakdown?.hardDepsSatisfied, 60);
      });

      it('should give zero hard deps points when hard dependencies are not met', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ 
          name: 'Task 2', 
          dependencies: [{ taskId: task1.id, type: 'hard' }] 
        });

        const check = service.canExecuteTask(task2.id);

        assert.strictEqual(check.canExecute, false);
        assert.strictEqual(check.readinessBreakdown?.hardDepsSatisfied, 0);
      });

      it('should give full soft deps points when no soft dependencies exist', () => {
        const task = service.createTask({ name: 'Test Task' });
        const check = service.canExecuteTask(task.id);

        assert.strictEqual(check.canExecute, true);
        assert.strictEqual(check.readinessBreakdown?.softDepsSatisfied, 20);
      });

      it('should give partial soft deps points based on proportion completed', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ name: 'Task 2' });
        const task3 = service.createTask({ 
          name: 'Task 3', 
          dependencies: [
            { taskId: task1.id, type: 'soft' },
            { taskId: task2.id, type: 'soft' }
          ] 
        });

        service.executeTask(task1.id);
        const check = service.canExecuteTask(task3.id);

        assert.strictEqual(check.canExecute, true);
        // 1 of 2 soft deps completed = 50% = 10 points
        assert.strictEqual(check.readinessBreakdown?.softDepsSatisfied, 10);
      });

      it('should allow execution with unmet soft dependencies', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ 
          name: 'Task 2', 
          dependencies: [{ taskId: task1.id, type: 'soft' }] 
        });

        const check = service.canExecuteTask(task2.id);

        assert.strictEqual(check.canExecute, true);
        // Soft deps not completed = 0 points, but execution still allowed
        assert.strictEqual(check.readinessBreakdown?.softDepsSatisfied, 0);
      });

      it('should respect onFailure: skip for failed hard dependencies', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ 
          name: 'Task 2', 
          dependencies: [{ taskId: task1.id, type: 'hard', onFailure: 'skip' }] 
        });

        service.failTask(task1.id, 'Task 1 failed');
        const check = service.canExecuteTask(task2.id);

        assert.strictEqual(check.canExecute, true);
        assert.strictEqual(check.readinessBreakdown?.hardDepsSatisfied, 60);
      });

      it('should respect onFailure: proceed for failed hard dependencies', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ 
          name: 'Task 2', 
          dependencies: [{ taskId: task1.id, type: 'hard', onFailure: 'proceed' }] 
        });

        service.failTask(task1.id, 'Task 1 failed');
        const check = service.canExecuteTask(task2.id);

        assert.strictEqual(check.canExecute, true);
        assert.strictEqual(check.readinessBreakdown?.hardDepsSatisfied, 60);
      });

      it('should block with onFailure: block for failed hard dependencies', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ 
          name: 'Task 2', 
          dependencies: [{ taskId: task1.id, type: 'hard', onFailure: 'block' }] 
        });

        service.failTask(task1.id, 'Task 1 failed');
        const check = service.canExecuteTask(task2.id);

        assert.strictEqual(check.canExecute, false);
        assert.strictEqual(check.readinessBreakdown?.hardDepsSatisfied, 0);
      });

      it('should normalize task priority to 0-10 points', () => {
        const task100 = service.createTask({ name: 'Task 100', priority: 100 });
        const task50 = service.createTask({ name: 'Task 50', priority: 50 });
        const task0 = service.createTask({ name: 'Task 0', priority: 0 });

        const check100 = service.canExecuteTask(task100.id);
        const check50 = service.canExecuteTask(task50.id);
        const check0 = service.canExecuteTask(task0.id);

        assert.strictEqual(check100.readinessBreakdown?.taskPriority, 10);
        assert.strictEqual(check50.readinessBreakdown?.taskPriority, 5);
        assert.strictEqual(check0.readinessBreakdown?.taskPriority, 0);
      });

      it('should use default priority (5 points) when priority not set', () => {
        const task = service.createTask({ name: 'Test Task' });
        const check = service.canExecuteTask(task.id);

        assert.strictEqual(check.readinessBreakdown?.taskPriority, 5);
      });

      it('should add priorityBoost from dependency metadata', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ 
          name: 'Task 2', 
          dependencies: [{ 
            taskId: task1.id, 
            type: 'hard',
            metadata: { priorityBoost: 5 }
          }] 
        });

        service.executeTask(task1.id);
        const check = service.canExecuteTask(task2.id);

        assert.strictEqual(check.canExecute, true);
        assert.strictEqual(check.readinessBreakdown?.priorityBoost, 5);
      });

      it('should clamp priorityBoost to maximum of +10', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ 
          name: 'Task 2', 
          dependencies: [{ 
            taskId: task1.id, 
            type: 'hard',
            metadata: { priorityBoost: 20 }
          }] 
        });

        service.executeTask(task1.id);
        const check = service.canExecuteTask(task2.id);

        assert.strictEqual(check.canExecute, true);
        assert.strictEqual(check.readinessBreakdown?.priorityBoost, 10);
      });

      it('should clamp priorityBoost to minimum of -10', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ 
          name: 'Task 2', 
          dependencies: [{ 
            taskId: task1.id, 
            type: 'hard',
            metadata: { priorityBoost: -20 }
          }] 
        });

        service.executeTask(task1.id);
        const check = service.canExecuteTask(task2.id);

        assert.strictEqual(check.canExecute, true);
        assert.strictEqual(check.readinessBreakdown?.priorityBoost, -10);
      });

      it('should sum priorityBoost from multiple dependencies', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ name: 'Task 2' });
        const task3 = service.createTask({ 
          name: 'Task 3', 
          dependencies: [
            { taskId: task1.id, type: 'hard', metadata: { priorityBoost: 3 } },
            { taskId: task2.id, type: 'hard', metadata: { priorityBoost: 4 } }
          ] 
        });

        service.executeTask(task1.id);
        service.executeTask(task2.id);
        const check = service.canExecuteTask(task3.id);

        assert.strictEqual(check.canExecute, true);
        assert.strictEqual(check.readinessBreakdown?.priorityBoost, 7);
      });

      it('should keep total score within 0-100 range', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ 
          name: 'Task 2', 
          dependencies: [{ 
            taskId: task1.id, 
            type: 'hard',
            metadata: { priorityBoost: 20 }
          }],
          priority: 100
        });

        service.executeTask(task1.id);
        const check = service.canExecuteTask(task2.id);

        assert.strictEqual(check.canExecute, true);
        assert.ok(check.readinessScore! >= 0);
        assert.ok(check.readinessScore! <= 100);
      });
    });

    describe('Intelligent Scheduling - Task Ordering', () => {
      it('should sort tasks by readinessScore descending', () => {
        const task1 = service.createTask({ name: 'Task 1', priority: 30 });
        const task2 = service.createTask({ name: 'Task 2', priority: 80 });
        const task3 = service.createTask({ name: 'Task 3', priority: 50 });

        const executableTasks = service.getNextExecutableTasks();

        assert.strictEqual(executableTasks.length, 3);
        // Highest priority (80) should be first
        assert.strictEqual(executableTasks[0].id, task2.id);
        // Mid priority (50) should be second
        assert.strictEqual(executableTasks[1].id, task3.id);
        // Lowest priority (30) should be third
        assert.strictEqual(executableTasks[2].id, task1.id);
      });

      it('should use dependent count as tie-breaker when scores are equal', () => {
        const task1 = service.createTask({ name: 'Task 1', priority: 50 });
        const task2 = service.createTask({ name: 'Task 2', priority: 50 });
        const task3 = service.createTask({ name: 'Task 3', priority: 50 });

        // Make task1 have more dependents
        service.createTask({ name: 'Dependent 1', dependencies: [{ taskId: task1.id, type: 'hard' }] });
        service.createTask({ name: 'Dependent 2', dependencies: [{ taskId: task1.id, type: 'hard' }] });
        service.createTask({ name: 'Dependent 3', dependencies: [{ taskId: task2.id, type: 'hard' }] });

        const executableTasks = service.getNextExecutableTasks();

        assert.strictEqual(executableTasks.length, 3);
        // task1 has 2 dependents, should be first
        assert.strictEqual(executableTasks[0].id, task1.id);
        // task2 has 1 dependent, should be second
        assert.strictEqual(executableTasks[1].id, task2.id);
        // task3 has 0 dependents, should be third
        assert.strictEqual(executableTasks[2].id, task3.id);
      });

      it('should use task priority as final tie-breaker', () => {
        const task1 = service.createTask({ name: 'Task 1', priority: 70 });
        const task2 = service.createTask({ name: 'Task 2', priority: 90 });

        const executableTasks = service.getNextExecutableTasks();

        assert.strictEqual(executableTasks.length, 2);
        assert.strictEqual(executableTasks[0].id, task2.id);
        assert.strictEqual(executableTasks[1].id, task1.id);
      });

      it('should only return truly executable tasks', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ name: 'Task 2', dependencies: [{ taskId: task1.id, type: 'hard' }] });
        const task3 = service.createTask({ name: 'Task 3' });

        const executableTasks = service.getNextExecutableTasks();

        assert.strictEqual(executableTasks.length, 2);
        assert.ok(executableTasks.some(t => t.id === task1.id));
        assert.ok(executableTasks.some(t => t.id === task3.id));
        assert.ok(!executableTasks.some(t => t.id === task2.id));
      });

      it('should return empty array when no tasks are executable', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ name: 'Task 2', dependencies: [{ taskId: task1.id, type: 'hard' }] });

        const executableTasks = service.getNextExecutableTasks();

        assert.strictEqual(executableTasks.length, 1);
        assert.strictEqual(executableTasks[0].id, task1.id);
      });
    });

    describe('Intelligent Scheduling - Workflow Execution', () => {
      it('should sort workflow ready tasks by readinessScore', () => {
        const task1 = service.createTask({ name: 'Task 1', priority: 30 });
        const task2 = service.createTask({ name: 'Task 2', priority: 80 });
        const task3 = service.createTask({ name: 'Task 3', priority: 50 });

        const workflow = service.createWorkflow('Test Workflow', [task1.id, task2.id, task3.id]);
        const run = service.startWorkflowExecution(workflow.id);

        assert.ok(run);
        assert.strictEqual(run!.readyTasks.length, 3);
        // Highest priority should be first (marked in progress first)
        assert.strictEqual(run!.readyTasks[0].id, task2.id);
        assert.strictEqual(run!.readyTasks[1].id, task3.id);
        assert.strictEqual(run!.readyTasks[2].id, task1.id);
      });

      it('should mark tasks as in progress after sorting in workflow', () => {
        const task1 = service.createTask({ name: 'Task 1', priority: 30 });
        const task2 = service.createTask({ name: 'Task 2', priority: 80 });

        const workflow = service.createWorkflow('Test Workflow', [task1.id, task2.id]);
        const run = service.startWorkflowExecution(workflow.id);

        assert.ok(run);

        // Both tasks should be marked as in progress
        const updatedTask1 = service.getTask(task1.id);
        const updatedTask2 = service.getTask(task2.id);

        assert.strictEqual(updatedTask1?.status, TASK_STATUS.IN_PROGRESS);
        assert.strictEqual(updatedTask2?.status, TASK_STATUS.IN_PROGRESS);
      });

      it('should respect soft dependencies in workflow scheduling', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ 
          name: 'Task 2', 
          dependencies: [{ taskId: task1.id, type: 'soft' }] 
        });

        const workflow = service.createWorkflow('Test Workflow', [task1.id, task2.id]);
        const run = service.startWorkflowExecution(workflow.id);

        assert.ok(run);
        // Both tasks should be ready (soft deps don't block)
        assert.strictEqual(run!.readyTasks.length, 2);
        assert.ok(run!.readyTasks.some(t => t.id === task1.id));
        assert.ok(run!.readyTasks.some(t => t.id === task2.id));
      });

      describe('Bug Fix: Tasks with positional dependencies should not disappear', () => {
        it('should retain all tasks when creating workflow with positional dependencies', () => {
          // Reproduce the bug from the test report
          const tasks = service.createTasks([
            { name: 'Test Task 1', priority: 5 },
            { name: 'Test Task 2', priority: 3, dependencies: ['task-1'] },
            { name: 'Test Task 3', priority: 1 }
          ]);

          assert.strictEqual(tasks.length, 3);

          // All tasks should be retrievable via getTask
          const task1 = service.getTask(tasks[0].id);
          const task2 = service.getTask(tasks[1].id);
          const task3 = service.getTask(tasks[2].id);

          assert.ok(task1, 'Task 1 should exist');
          assert.ok(task2, 'Task 2 should exist');
          assert.ok(task3, 'Task 3 should exist');

          // All tasks should appear in getAllTasks
          const allTasks = service.getAllTasks();
          assert.strictEqual(allTasks.length, 3);
          assert.ok(allTasks.some(t => t.id === tasks[0].id));
          assert.ok(allTasks.some(t => t.id === tasks[1].id));
          assert.ok(allTasks.some(t => t.id === tasks[2].id));

          // Task 2 should have its dependency resolved
          assert.strictEqual(task2?.dependencies.length, 1);
          assert.strictEqual(task2?.dependencies[0], tasks[0].id);
        });

        it('should retain all tasks when creating workflow with positional dependencies and starting execution', () => {
          const tasks = service.createTasks([
            { name: 'Test Task 1', priority: 5 },
            { name: 'Test Task 2', priority: 3, dependencies: ['task-1'] },
            { name: 'Test Task 3', priority: 1 }
          ]);

          const workflow = service.createWorkflow('Test Workflow', tasks.map(t => t.id));
          const run = service.startWorkflowExecution(workflow.id);

          assert.ok(run);

          // All tasks should still be retrievable after workflow execution starts
          const task1 = service.getTask(tasks[0].id);
          const task2 = service.getTask(tasks[1].id);
          const task3 = service.getTask(tasks[2].id);

          assert.ok(task1, 'Task 1 should exist after workflow start');
          assert.ok(task2, 'Task 2 should exist after workflow start');
          assert.ok(task3, 'Task 3 should exist after workflow start');

          // Only Task 1 and Task 3 should be ready (Task 2 depends on Task 1)
          assert.strictEqual(run!.readyTasks.length, 2);
          assert.ok(run!.readyTasks.some(t => t.id === tasks[0].id));
          assert.ok(run!.readyTasks.some(t => t.id === tasks[2].id));
          assert.ok(!run!.readyTasks.some(t => t.id === tasks[1].id));
        });

        it('should correctly track blocked tasks in workflow with positional dependencies', () => {
          const tasks = service.createTasks([
            { name: 'Test Task 1', priority: 5 },
            { name: 'Test Task 2', priority: 3, dependencies: ['task-1'] },
            { name: 'Test Task 3', priority: 1 }
          ]);

          const workflow = service.createWorkflow('Test Workflow', tasks.map(t => t.id));
          const run = service.startWorkflowExecution(workflow.id);

          assert.ok(run);

          // Get the workflow run to check blocked tasks
          const workflowRun = service.getWorkflowRun(run!.runId);
          assert.ok(workflowRun);

          // Task 2 should be in blockedTaskIds
          assert.ok(workflowRun!.blockedTaskIds.includes(tasks[1].id));
        });

        it('should complete workflow successfully when all tasks are finished', () => {
          const tasks = service.createTasks([
            { name: 'Test Task 1', priority: 5 },
            { name: 'Test Task 2', priority: 3, dependencies: ['task-1'] },
            { name: 'Test Task 3', priority: 1 }
          ]);

          const workflow = service.createWorkflow('Test Workflow', tasks.map(t => t.id));
          const run = service.startWorkflowExecution(workflow.id);

          assert.ok(run);

          // Complete Task 1
          service.executeTask(tasks[0].id);
          service.advanceWorkflowRun(run!.runId);

          // Complete Task 3
          service.executeTask(tasks[2].id);
          const advanceResult = service.advanceWorkflowRun(run!.runId);

          // Task 2 should now be ready
          assert.ok(advanceResult);
          assert.strictEqual(advanceResult!.newlyReadyTasks.length, 1);
          assert.strictEqual(advanceResult!.newlyReadyTasks[0].id, tasks[1].id);

          // Complete Task 2
          service.executeTask(tasks[1].id);
          const finalAdvance = service.advanceWorkflowRun(run!.runId);

          // Workflow should be completed
          assert.ok(finalAdvance);
          assert.strictEqual(finalAdvance!.workflowStatus, 'completed');
        });

        it('should maintain consistent state between get_task, list_tasks, and get_dependency_graph', () => {
          const tasks = service.createTasks([
            { name: 'Test Task 1', priority: 5 },
            { name: 'Test Task 2', priority: 3, dependencies: ['task-1'] },
            { name: 'Test Task 3', priority: 1 }
          ]);

          const workflow = service.createWorkflow('Test Workflow', tasks.map(t => t.id));
          service.startWorkflowExecution(workflow.id);

          // Check consistency across different retrieval methods
          const allTasks = service.getAllTasks();
          assert.strictEqual(allTasks.length, 3);

          // Each task should be retrievable individually
          for (const task of tasks) {
            const retrieved = service.getTask(task.id);
            assert.ok(retrieved, `Task ${task.name} should be retrievable via getTask`);
            assert.strictEqual(retrieved?.id, task.id);
          }

          // Dependency graph should include all tasks
          const depGraph = service.getDependencyGraph(workflow.id);
          assert.ok(depGraph);
          assert.strictEqual(depGraph!.nodes.length, 3);
        });

        describe('Workflow Bundle Export/Import', () => {
          it('should export a simple workflow with basic tasks', () => {
            const tasks = service.createTasks([
              { name: 'Task 1' },
              { name: 'Task 2' },
              { name: 'Task 3' }
            ]);

            const workflow = service.createWorkflow('Test Workflow', tasks.map(t => t.id));
            const bundle = service.exportWorkflowBundle(workflow.id);

            assert.ok(bundle);
            assert.strictEqual(bundle.workflow.name, 'Test Workflow');
            assert.strictEqual(bundle.tasks.length, 3);
            assert.strictEqual(bundle.version, '1.0.0');
            assert.ok(bundle.exportedAt);
            assert.strictEqual(bundle.templateName, 'Test Workflow');
          });

          it('should export a workflow with subtasks (hierarchical structure)', () => {
            const parentTask = service.createTask({ name: 'Parent Task' });
            const childTasks = service.createTasks([
              { name: 'Child Task 1', parentTaskId: parentTask.id },
              { name: 'Child Task 2', parentTaskId: parentTask.id }
            ]);

            const workflow = service.createWorkflow('Hierarchical Workflow', [parentTask.id, ...childTasks.map(t => t.id)]);
            const bundle = service.exportWorkflowBundle(workflow.id);

            assert.ok(bundle);
            assert.strictEqual(bundle.tasks.length, 3); // Parent + 2 children
            assert.ok(bundle.tasks.some(t => t.name === 'Parent Task'));
            assert.ok(bundle.tasks.some(t => t.name === 'Child Task 1'));
            assert.ok(bundle.tasks.some(t => t.name === 'Child Task 2'));
          });

          it('should export a workflow with rich dependencies', () => {
            const tasks = service.createTasks([
              { name: 'Task 1' },
              { name: 'Task 2', dependencies: [{ taskId: 'task-1', type: 'hard', onFailure: 'block' }] },
              { name: 'Task 3', dependencies: [{ taskId: 'task-1', type: 'soft' }] }
            ]);

            const workflow = service.createWorkflow('Complex Workflow', tasks.map(t => t.id));
            const bundle = service.exportWorkflowBundle(workflow.id);

            assert.ok(bundle);
            assert.strictEqual(bundle.tasks.length, 3);
            
            const task2 = bundle.tasks.find(t => t.name === 'Task 2');
            assert.ok(task2);
            assert.ok(Array.isArray(task2?.dependencies));
            assert.strictEqual(task2?.dependencies.length, 1);
          });

          it('should throw error when exporting non-existent workflow', () => {
            assert.throws(() => {
              service.exportWorkflowBundle('non-existent-workflow-id');
            });
          });

          it('should import a basic workflow bundle', () => {
            const originalTasks = service.createTasks([
              { name: 'Original Task 1' },
              { name: 'Original Task 2' }
            ]);

            const originalWorkflow = service.createWorkflow('Original Workflow', originalTasks.map(t => t.id));
            const bundle = service.exportWorkflowBundle(originalWorkflow.id);

            // Clear all to simulate fresh session
            service.clearAll();

            // Import the bundle
            const importResult = service.importWorkflowBundle(bundle);

            assert.ok(importResult);
            assert.ok(importResult.newWorkflowId);
            assert.ok(importResult.taskIdMap);
            assert.strictEqual(Object.keys(importResult.taskIdMap).length, 2);

            // Verify the new workflow exists
            const newWorkflow = service.getWorkflow(importResult.newWorkflowId);
            assert.ok(newWorkflow);
            assert.strictEqual(newWorkflow?.name, 'Original Workflow');
            assert.strictEqual(newWorkflow?.taskIds.length, 2);

            // Verify tasks were created with new IDs
            const allTasks = service.getAllTasks();
            assert.strictEqual(allTasks.length, 2);
          });

          it('should import with namePrefix option', () => {
            const originalTasks = service.createTasks([
              { name: 'Task 1' },
              { name: 'Task 2' }
            ]);

            const originalWorkflow = service.createWorkflow('My Workflow', originalTasks.map(t => t.id));
            const bundle = service.exportWorkflowBundle(originalWorkflow.id);

            service.clearAll();

            const importResult = service.importWorkflowBundle(bundle, { namePrefix: 'Project A - ' });

            const newWorkflow = service.getWorkflow(importResult.newWorkflowId);
            assert.ok(newWorkflow);
            assert.strictEqual(newWorkflow?.name, 'Project A - My Workflow');

            const allTasks = service.getAllTasks();
            assert.strictEqual(allTasks.length, 2);
            assert.ok(allTasks.every(t => t.name.startsWith('Project A - ')));
          });

          it('should import with deduplication strategies', () => {
            const originalTasks = service.createTasks([
              { name: 'Task 1' },
              { name: 'Task 2' }
            ]);

            const originalWorkflow = service.createWorkflow('Workflow', originalTasks.map(t => t.id));
            const bundle = service.exportWorkflowBundle(originalWorkflow.id);

            service.clearAll();

            // Test with 'skip' deduplication
            const importResult = service.importWorkflowBundle(bundle, { deduplication: 'skip' });
            assert.ok(importResult);
          });

          it('should handle import/export roundtrip correctly', () => {
            // Create a complex workflow with subtasks and dependencies
            const parentTask = service.createTask({ name: 'Parent Task' });
            const childTasks = service.createTasks([
              { name: 'Child Task 1', parentTaskId: parentTask.id },
              { name: 'Child Task 2', parentTaskId: parentTask.id, dependencies: ['task-1'] }
            ]);

            const originalWorkflow = service.createWorkflow('Complex Workflow', [parentTask.id, ...childTasks.map(t => t.id)]);
            const originalTaskIds = [parentTask.id, ...childTasks.map(t => t.id)];

            // Export
            const bundle = service.exportWorkflowBundle(originalWorkflow.id);

            // Clear and import
            service.clearAll();
            const importResult = service.importWorkflowBundle(bundle);

            // Verify structure is preserved
            const newWorkflow = service.getWorkflow(importResult.newWorkflowId);
            assert.ok(newWorkflow);
            assert.strictEqual(newWorkflow?.name, 'Complex Workflow');
            assert.strictEqual(newWorkflow?.taskIds.length, 3);

            // Verify hierarchy is preserved
            const allTasks = service.getAllTasks();
            const newParentTask = allTasks.find(t => t.name === 'Parent Task');
            assert.ok(newParentTask);

            const newChildTasks = allTasks.filter(t => t.parentTaskId === newParentTask?.id);
            assert.strictEqual(newChildTasks.length, 2);
          });

          it('should throw error when importing invalid bundle', () => {
            const invalidBundle = {
              workflow: null,
              tasks: [],
              version: '1.0.0',
              exportedAt: new Date().toISOString()
            };

            assert.throws(() => {
              service.importWorkflowBundle(invalidBundle as any);
            });
          });

          it('should remap all task IDs during import', () => {
            const originalTasks = service.createTasks([
              { name: 'Task 1' },
              { name: 'Task 2', dependencies: ['task-1'] }
            ]);

            const originalWorkflow = service.createWorkflow('ID Remap Test', originalTasks.map(t => t.id));
            const originalTaskIds = originalTasks.map(t => t.id);

            const bundle = service.exportWorkflowBundle(originalWorkflow.id);
            service.clearAll();

            const importResult = service.importWorkflowBundle(bundle);

            // All original IDs should be mapped to new IDs
            for (const originalId of originalTaskIds) {
              assert.ok(importResult.taskIdMap[originalId]);
              assert.notStrictEqual(importResult.taskIdMap[originalId], originalId);
            }

            // New IDs should be different from original IDs
            const newTaskIds = Object.values(importResult.taskIdMap);
            for (const newId of newTaskIds) {
              assert.ok(!originalTaskIds.includes(newId));
            }
          });
        });
      });
    });
  });
}
