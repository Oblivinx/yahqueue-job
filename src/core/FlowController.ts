import type { Job, JobPayload } from '../types/job.types.js';
import type { ChainStep, DAGConfig, DAGNode } from '../types/flow.types.js';
import type { IStorageAdapter } from '../types/adapter.types.js';
import { createJob, updateJob } from '../job/Job.js';
import { JobState } from '../job/JobState.js';
import { DependencyError, CyclicDependencyError } from '../errors/DependencyError.js';
import { generateId } from '../utils/idGenerator.js';

const DAG_DEFAULTS = {
    defaultPriority: 5,
    defaultMaxAttempts: 3,
    defaultMaxDuration: 30_000,
};

/**
 * FlowController — manages job chaining (A→B→C) and DAG dependency graphs.
 */
export class FlowController {
    private readonly adapter: IStorageAdapter;
    /** nodeId → DAGNode for all in-flight DAG nodes */
    private readonly dagNodes = new Map<string, DAGNode>();
    /** nodeId → jobId mapping */
    private readonly nodeToJob = new Map<string, string>();

    constructor(adapter: IStorageAdapter) {
        this.adapter = adapter;
    }

    /**
     * Enqueue a simple ordered chain: A → B → C
     * Returns the flowId.
     */
    async chain(steps: ChainStep[]): Promise<string> {
        if (steps.length === 0) return generateId();
        const flowId = generateId();
        // Enqueue only the first step; subsequent steps are triggered by onJobComplete
        const firstStep = steps[0]!;
        const job = createJob({ ...firstStep, flowId }, DAG_DEFAULTS);
        // Store remaining chain steps in flow metadata
        this.chainMap.set(flowId, { steps, currentIndex: 0 });
        await this.adapter.push(job);
        return flowId;
    }

    /** chain metadata store */
    private readonly chainMap = new Map<
        string,
        { steps: ChainStep[]; currentIndex: number }
    >();

    /**
     * Called by the queue when a job completes.
     * Triggers the next step in a chain, or unlocks DAG dependents.
     */
    async onJobComplete<T extends JobPayload>(job: Job<T>): Promise<void> {
        // Handle chain
        if (job.flowId && this.chainMap.has(job.flowId)) {
            await this.advanceChain(job.flowId);
        }
        // Handle DAG
        if (job.flowId && !this.chainMap.has(job.flowId)) {
            await this.unlockDAGDependents(job.id);
        }
    }

    /**
     * Called by the queue when a job fails permanently.
     * Cancels all downstream dependents.
     */
    onJobFail<T extends JobPayload>(job: Job<T>): void {
        if (job.flowId && this.chainMap.has(job.flowId)) {
            this.chainMap.delete(job.flowId);
        }
        // Cancel DAG subtree
        this.cancelDownstream(job.id);
    }

    /**
     * Enqueue a DAG configuration.
     * Performs topological sort (Kahn's algorithm), validates for cycles.
     * Returns flowId.
     */
    async dag(config: DAGConfig): Promise<string> {
        const flowId = generateId();
        const nodeIds = Object.keys(config.nodes);

        // Build dependency graph
        const inDegree = new Map<string, number>();
        const adj = new Map<string, string[]>();
        for (const id of nodeIds) {
            inDegree.set(id, 0);
            adj.set(id, []);
        }
        for (const [id, node] of Object.entries(config.nodes)) {
            for (const dep of node.dependsOn ?? []) {
                adj.get(dep)!.push(id);
                inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
            }
        }

        // Kahn's topological sort — also detects cycles
        const queue: string[] = [];
        for (const [id, deg] of inDegree) {
            if (deg === 0) queue.push(id);
        }
        const order: string[] = [];
        while (queue.length > 0) {
            const cur = queue.shift()!;
            order.push(cur);
            for (const neighbor of adj.get(cur) ?? []) {
                const newDeg = inDegree.get(neighbor)! - 1;
                inDegree.set(neighbor, newDeg);
                if (newDeg === 0) queue.push(neighbor);
            }
        }
        if (order.length !== nodeIds.length) {
            throw new CyclicDependencyError(nodeIds);
        }

        // Register all dag nodes
        for (const [id, node] of Object.entries(config.nodes)) {
            const jobId = generateId();
            const dagNode: DAGNode = {
                id,
                jobId,
                type: node.type,
                deps: node.dependsOn ?? [],
                completedDeps: new Set(),
            };
            this.dagNodes.set(id, dagNode);
            this.nodeToJob.set(id, jobId);
        }

        // Enqueue root nodes (in-degree = 0)
        for (const [id, node] of Object.entries(config.nodes)) {
            if ((node.dependsOn ?? []).length === 0) {
                const dagNode = this.dagNodes.get(id)!;
                const job = createJob(
                    { ...node, flowId, dependsOn: [] },
                    DAG_DEFAULTS,
                );
                // Remap the job id to our pre-assigned jobId
                const remapped = updateJob(job, { flowId });
                this.dagNodes.set(id, { ...dagNode, jobId: remapped.id });
                await this.adapter.push(remapped);
            }
        }

        return flowId;
    }

    // ─── Private helpers ──────────────────────────────────────────────────────────

    private async advanceChain(flowId: string): Promise<void> {
        const flow = this.chainMap.get(flowId);
        if (!flow) return;
        const nextIndex = flow.currentIndex + 1;
        if (nextIndex >= flow.steps.length) {
            this.chainMap.delete(flowId);
            return;
        }
        const nextStep = flow.steps[nextIndex]!;
        flow.currentIndex = nextIndex;
        const job = createJob({ ...nextStep, flowId }, DAG_DEFAULTS);
        await this.adapter.push(job);
    }

    private async unlockDAGDependents(completedJobId: string): Promise<void> {
        for (const [nodeId, dagNode] of this.dagNodes) {
            if (dagNode.deps.includes(completedJobId)) {
                dagNode.completedDeps.add(completedJobId);
                if (dagNode.completedDeps.size === dagNode.deps.length) {
                    // All deps satisfied — enqueue this node
                    const job = createJob(
                        { type: dagNode.type, payload: {}, flowId: nodeId },
                        DAG_DEFAULTS,
                    );
                    this.dagNodes.delete(nodeId);
                    await this.adapter.push(job);
                }
            }
        }
    }

    private cancelDownstream(failedNodeId: string): void {
        for (const dagNode of this.dagNodes.values()) {
            if (dagNode.deps.includes(failedNodeId)) {
                throw new DependencyError(dagNode.jobId, failedNodeId);
            }
        }
    }
}
