import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { SequentialService } from '../src/sequentialService.js';
import { resetConfigManager } from '../src/config.js';
import { TASK_STATUS } from '../src/constants.js';
import type { Task } from '../src/types.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_STORAGE_PATH = path.join(__dirname, 'test-storage.json');

describe('SequentialService', () => {
  let service: SequentialService;

  beforeEach(async () => {
    resetConfigManager();
    service = new SequentialService(TEST_STORAGE_PATH);
    await service.load();
  });

  afterEach(async () => {
    service.clearAll();
    await service.save();
    try {
      await fs.unlink(TEST_STORAGE_PATH);
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

    it('should not execute task with unmet dependencies', () => {
      const task1 = service.createTask({ name: 'Task 1' });
      const task2 = service.createTask({ name: 'Task 2', dependencies: [task1.id] });

      const executed = service.executeTask(task2.id);
      assert.strictEqual(executed, null);
    });

    it('should execute task when dependencies are met', () => {
      const task1 = service.createTask({ name: 'Task 1' });
      const task2 = service.createTask({ name: 'Task 2', dependencies: [task1.id] });

      service.executeTask(task1.id);
      const executed = service.executeTask(task2.id);

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

      const newService = new SequentialService(TEST_STORAGE_PATH);
      await newService.load();

      const loadedTask = newService.getTask(task.id);
      assert.ok(loadedTask);
      assert.strictEqual(loadedTask?.name, 'Test Task');
      assert.strictEqual(loadedTask?.id, task.id);
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
});
