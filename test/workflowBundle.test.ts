import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { TaskOrchestratorService } from '../src/taskOrchestratorService.js';
import { resetConfigManager } from '../src/config.js';
import { StorageFactory } from '../src/storage/StorageFactory.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_JSON_STORAGE_PATH = path.join(__dirname, 'test-storage-bundle.json');

const testCases = [
  { name: 'JSON Storage', backend: 'json' as const, path: TEST_JSON_STORAGE_PATH }
];

for (const testCase of testCases) {
  describe(`Workflow Bundle Export/Import with ${testCase.name}`, () => {
    let service: TaskOrchestratorService;
    let storageAdapter: any;

    beforeEach(async () => {
      resetConfigManager();
      process.env.TASK_ORCHESTRATOR_AUTO_SAVE = 'false';
      storageAdapter = StorageFactory.createAdapter(testCase.backend, testCase.path);
      await storageAdapter.initialize();
      service = new TaskOrchestratorService(storageAdapter);
      await service.load();
    });

    afterEach(async () => {
      await service.forceSave();
      await service.shutdown();
      await service.clearAll();
      await storageAdapter.close();
      try {
        await fs.unlink(testCase.path);
      } catch {
        // File might not exist
      }
    });

    describe('exportWorkflowBundle', () => {
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
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ 
          name: 'Task 2', 
          dependencies: [{ taskId: task1.id, type: 'hard', onFailure: 'block' }] 
        });
        const task3 = service.createTask({ 
          name: 'Task 3', 
          dependencies: [{ taskId: task1.id, type: 'soft' }] 
        });

        const workflow = service.createWorkflow('Complex Workflow', [task1.id, task2.id, task3.id]);
        const bundle = service.exportWorkflowBundle(workflow.id);

        assert.ok(bundle);
        assert.strictEqual(bundle.tasks.length, 3);
        
        const exportedTask2 = bundle.tasks.find(t => t.name === 'Task 2');
        assert.ok(exportedTask2);
        assert.ok(Array.isArray(exportedTask2?.dependencies));
        assert.strictEqual(exportedTask2?.dependencies.length, 1);
      });

      it('should throw error when exporting non-existent workflow', () => {
        assert.throws(() => {
          service.exportWorkflowBundle('non-existent-workflow-id');
        });
      });
    });

    describe('importWorkflowBundle', () => {
      it('should import a basic workflow bundle', () => {
        const task1 = service.createTask({ name: 'Original Task 1' });
        const task2 = service.createTask({ name: 'Original Task 2' });

        const originalWorkflow = service.createWorkflow('Original Workflow', [task1.id, task2.id]);
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
        
        // Verify task names are preserved
        assert.ok(allTasks.some(t => t.name === 'Original Task 1'));
        assert.ok(allTasks.some(t => t.name === 'Original Task 2'));
      });

      it('should import with namePrefix option', () => {
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ name: 'Task 2' });

        const originalWorkflow = service.createWorkflow('My Workflow', [task1.id, task2.id]);
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
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ name: 'Task 2' });

        const originalWorkflow = service.createWorkflow('Workflow', [task1.id, task2.id]);
        const bundle = service.exportWorkflowBundle(originalWorkflow.id);

        service.clearAll();

        // Test with 'skip' deduplication
        const importResult = service.importWorkflowBundle(bundle, { deduplication: 'skip' });
        assert.ok(importResult);
      });

      it('should handle import/export roundtrip correctly', () => {
        // Create a simple workflow without dependencies for roundtrip test
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ name: 'Task 2' });
        const task3 = service.createTask({ name: 'Task 3' });

        const originalWorkflow = service.createWorkflow('Roundtrip Workflow', [task1.id, task2.id, task3.id]);

        // Export
        const bundle = service.exportWorkflowBundle(originalWorkflow.id);

        // Clear and import
        service.clearAll();
        const importResult = service.importWorkflowBundle(bundle);

        // Verify structure is preserved
        const newWorkflow = service.getWorkflow(importResult.newWorkflowId);
        assert.ok(newWorkflow);
        assert.strictEqual(newWorkflow?.name, 'Roundtrip Workflow');
        assert.strictEqual(newWorkflow?.taskIds.length, 3);

        // Verify tasks were recreated
        const allTasks = service.getAllTasks();
        assert.strictEqual(allTasks.length, 3);
        assert.ok(allTasks.some(t => t.name === 'Task 1'));
        assert.ok(allTasks.some(t => t.name === 'Task 2'));
        assert.ok(allTasks.some(t => t.name === 'Task 3'));
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
        const task1 = service.createTask({ name: 'Task 1' });
        const task2 = service.createTask({ name: 'Task 2' });

        const originalWorkflow = service.createWorkflow('ID Remap Test', [task1.id, task2.id]);
        const originalTaskIds = [task1.id, task2.id];

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
}
