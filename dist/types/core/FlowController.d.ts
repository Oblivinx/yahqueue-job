import type { Job, JobPayload } from '../types/job.types.js';
import type { ChainStep, DAGConfig } from '../types/flow.types.js';
import type { IStorageAdapter } from '../types/adapter.types.js';
/**
 * FlowController — manages job chaining (A→B→C) and DAG dependency graphs.
 */
export declare class FlowController {
    private readonly adapter;
    /** nodeId → DAGNode for all in-flight DAG nodes */
    private readonly dagNodes;
    /** nodeId → jobId mapping */
    private readonly nodeToJob;
    constructor(adapter: IStorageAdapter);
    /**
     * Enqueue a simple ordered chain: A → B → C
     * Returns the flowId.
     */
    chain(steps: ChainStep[]): Promise<string>;
    /** chain metadata store */
    private readonly chainMap;
    /**
     * Called by the queue when a job completes.
     * Triggers the next step in a chain, or unlocks DAG dependents.
     */
    onJobComplete<T extends JobPayload>(job: Job<T>): Promise<void>;
    /**
     * Called by the queue when a job fails permanently.
     * Cancels all downstream dependents.
     */
    onJobFail<T extends JobPayload>(job: Job<T>): void;
    /**
     * Enqueue a DAG configuration.
     * Performs topological sort (Kahn's algorithm), validates for cycles.
     * Returns flowId.
     */
    dag(config: DAGConfig): Promise<string>;
    private advanceChain;
    private unlockDAGDependents;
    private cancelDownstream;
}
