"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IpcRouter = void 0;
const QueueError_js_1 = require("../errors/QueueError.cjs");
class IpcRouter {
    shards = new Map();
    pendingRequests = new Map();
    reqCounter = 0;
    /**
     * Register a child process to handle jobs for a specific shardKey.
     */
    registerShard(shardKey, child) {
        this.shards.set(shardKey, child);
        child.on('message', (msg) => {
            if (msg.reqId && this.pendingRequests.has(msg.reqId)) {
                const { resolve, reject } = this.pendingRequests.get(msg.reqId);
                if (msg.error)
                    reject(new QueueError_js_1.QueueError(`IPC Error: ${msg.error}`));
                else
                    resolve(msg.payload);
                this.pendingRequests.delete(msg.reqId);
            }
        });
    }
    async enqueue(options) {
        const { shardKey } = options;
        if (!shardKey)
            throw new QueueError_js_1.QueueError('enqueue() via IpcRouter requires a shardKey');
        const child = this.shards.get(shardKey);
        if (!child)
            throw new QueueError_js_1.QueueError(`No shard registered for key: ${shardKey}`);
        return this.sendRequest(child, 'enqueue', options);
    }
    pause() {
        for (const child of this.shards.values()) {
            child.send({ cmd: 'pause' });
        }
    }
    resume() {
        for (const child of this.shards.values()) {
            child.send({ cmd: 'resume' });
        }
    }
    async shutdown() {
        const promises = Array.from(this.shards.values()).map(child => this.sendRequest(child, 'shutdown', {}));
        await Promise.allSettled(promises);
    }
    sendRequest(child, cmd, payload) {
        return new Promise((resolve, reject) => {
            if (!child.connected) {
                return reject(new QueueError_js_1.QueueError(`IPC Channel closed for shard`));
            }
            const reqId = `${Date.now()}_${++this.reqCounter}`;
            this.pendingRequests.set(reqId, { resolve, reject });
            // Timeout to prevent hanging
            setTimeout(() => {
                if (this.pendingRequests.has(reqId)) {
                    this.pendingRequests.delete(reqId);
                    reject(new QueueError_js_1.QueueError(`IPC Request timeout for cmd: ${cmd}`));
                }
            }, 5000);
            child.send({ cmd, reqId, payload }, (err) => {
                if (err) {
                    this.pendingRequests.delete(reqId);
                    reject(err);
                }
            });
        });
    }
}
exports.IpcRouter = IpcRouter;
