import { describe, it, expect, beforeEach } from 'vitest';
import { FlowController } from '../../../src/core/FlowController.js';
import { MemoryAdapter } from '../../../src/adapters/MemoryAdapter.js';
import { CyclicDependencyError } from '../../../src/errors/DependencyError.js';

describe('FlowController', () => {
    let adapter: MemoryAdapter;
    let controller: FlowController;

    beforeEach(() => {
        adapter = new MemoryAdapter();
        controller = new FlowController(adapter);
    });

    it('chain with empty steps returns a flowId', async () => {
        const flowId = await controller.chain([]);
        expect(typeof flowId).toBe('string');
    });

    it('chain with steps enqueues the first step', async () => {
        const flowId = await controller.chain([
            { type: 'step1', payload: {} },
            { type: 'step2', payload: {} },
        ]);
        expect(typeof flowId).toBe('string');
        expect(await adapter.size()).toBe(1);
    });

    it('onJobComplete advances the chain', async () => {
        await controller.chain([
            { type: 'step1', payload: {} },
            { type: 'step2', payload: {} },
        ]);
        const job = await adapter.pop();
        expect(job!.type).toBe('step1');
        await controller.onJobComplete(job!);
        expect(await adapter.size()).toBe(1);
        const next = await adapter.pop();
        expect(next!.type).toBe('step2');
    });

    it('onJobComplete at last step clears chain', async () => {
        await controller.chain([{ type: 'only', payload: {} }]);
        const job = await adapter.pop();
        await controller.onJobComplete(job!);
        expect(await adapter.size()).toBe(0);
    });

    it('onJobFail cancels remaining chain steps', async () => {
        await controller.chain([
            { type: 'step1', payload: {} },
            { type: 'step2', payload: {} },
        ]);
        const job = await adapter.pop();
        controller.onJobFail(job!);
        // Chain should be cleared — onJobComplete should not advance
        await controller.onJobComplete(job!); // no-op since chain deleted
        expect(await adapter.size()).toBe(0);
    });

    it('dag enqueues root nodes (no deps)', async () => {
        const flowId = await controller.dag({
            nodes: {
                a: { type: 'typeA', payload: {} },
                b: { type: 'typeB', payload: {} },
                c: { type: 'typeC', payload: {}, dependsOn: ['a', 'b'] },
            },
        });
        expect(typeof flowId).toBe('string');
        expect(await adapter.size()).toBe(2); // a and b are roots
    });

    it('dag throws CyclicDependencyError on cyclic graph', async () => {
        await expect(controller.dag({
            nodes: {
                a: { type: 'a', payload: {}, dependsOn: ['b'] },
                b: { type: 'b', payload: {}, dependsOn: ['a'] },
            },
        })).rejects.toThrow(CyclicDependencyError);
    });
});
