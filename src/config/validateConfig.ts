import type { QueueConfig } from '../types/queue.types.js';
import { QueueError } from '../errors/QueueError.js';

/**
 * Runtime validation of QueueConfig.
 * Uses plain checks (no zod dependency required for runtime).
 * Zod can be used in user-land for schema docs if desired.
 *
 * @throws QueueError if config is invalid
 */
export function validateConfig(config: QueueConfig): void {
    if (!config.name || typeof config.name !== 'string' || config.name.trim() === '') {
        throw new QueueError('QueueConfig.name must be a non-empty string');
    }
    if (config.workers) {
        const w = config.workers;
        if (w.min !== undefined && w.min < 0) {
            throw new QueueError('QueueConfig.workers.min must be >= 0');
        }
        if (w.max !== undefined && w.max < 1) {
            throw new QueueError('QueueConfig.workers.max must be >= 1');
        }
        if (w.min !== undefined && w.max !== undefined && w.min > w.max) {
            throw new QueueError('QueueConfig.workers.min must be <= max');
        }
        if (w.monitorIntervalMs !== undefined && w.monitorIntervalMs < 100) {
            throw new QueueError('QueueConfig.workers.monitorIntervalMs must be >= 100ms');
        }
    }
    if (config.defaultMaxAttempts !== undefined && config.defaultMaxAttempts < 1) {
        throw new QueueError('QueueConfig.defaultMaxAttempts must be >= 1');
    }
    if (config.defaultMaxDuration !== undefined && config.defaultMaxDuration < 100) {
        throw new QueueError('QueueConfig.defaultMaxDuration must be >= 100ms');
    }
}
