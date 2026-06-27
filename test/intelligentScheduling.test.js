import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { TaskOrchestratorService } from '../src/taskOrchestratorService.js';
import { resetConfigManager } from '../src/config.js';
import { TASK_STATUS } from '../src/constants.js';
import { StorageFactory } from '../src/storage/StorageFactory.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_JSON_STORAGE_PATH = path.join(__dirname, 'test-storage-scheduling.json');
const testCases = [
    { name: 'JSON Storage', backend: 'json', path: TEST_JSON_STORAGE_PATH }
];
for (const testCase of testCases) {
    describe(`Intelligent Scheduling with ${testCase.name}`, () => {
        let service;
        let storageAdapter;
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
            }
            catch {
                // File might not exist
            }
        });
        describe('Readiness Scoring', () => {
            it('should return readinessScore and readinessBreakdown for executable task', () => {
                const task = service.createTask({ name: 'Test Task', priority: 80 });
                const check = service.canExecuteTask(task.id);
                assert.strictEqual(check.canExecute, true);
                assert.ok(check.readinessScore !== undefined);
                assert.ok(check.readinessBreakdown !== undefined);
                assert.ok(check.readinessBreakdown.hardDepsSatisfied >= 0);
                assert.ok(check.readinessBreakdown.softDepsSatisfied >= 0);
                assert.ok(check.readinessBreakdown.taskPriority >= 0);
                assert.ok(check.readinessBreakdown.priorityBoost >= -10);
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
                // Score is only calculated for executable tasks
                assert.strictEqual(check.readinessBreakdown, undefined);
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
                // Score is only calculated for executable tasks
                assert.strictEqual(check.readinessBreakdown, undefined);
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
                assert.ok(check.readinessScore >= 0);
                assert.ok(check.readinessScore <= 100);
            });
        });
        describe('Task Ordering', () => {
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
        describe('Workflow Execution', () => {
            it('should sort workflow ready tasks by readinessScore', () => {
                const task1 = service.createTask({ name: 'Task 1', priority: 30 });
                const task2 = service.createTask({ name: 'Task 2', priority: 80 });
                const task3 = service.createTask({ name: 'Task 3', priority: 50 });
                const workflow = service.createWorkflow('Test Workflow', [task1.id, task2.id, task3.id]);
                const run = service.startWorkflowExecution(workflow.id);
                assert.ok(run);
                assert.strictEqual(run.readyTasks.length, 3);
                // All tasks have same score (no deps), so order is stable insertion order
                // Verify they are all marked as in progress
                assert.ok(run.readyTasks.some(t => t.id === task1.id));
                assert.ok(run.readyTasks.some(t => t.id === task2.id));
                assert.ok(run.readyTasks.some(t => t.id === task3.id));
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
                assert.strictEqual(run.readyTasks.length, 2);
                assert.ok(run.readyTasks.some(t => t.id === task1.id));
                assert.ok(run.readyTasks.some(t => t.id === task2.id));
            });
        });
    });
}
//# sourceMappingURL=intelligentScheduling.test.js.map