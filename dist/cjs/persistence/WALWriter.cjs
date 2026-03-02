"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.WALWriter = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * WALWriter — Write-Ahead Log for crash recovery.
 * Each operation is appended as a JSON line (synchronous for atomicity).
 */
class WALWriter {
    walPath;
    seq = 0;
    enabled;
    constructor(walPath, enabled = true) {
        this.walPath = walPath;
        this.enabled = enabled;
    }
    /**
     * Initialize: ensure directory exists & read current sequence number.
     */
    initialize() {
        if (!this.enabled)
            return;
        const dir = path.dirname(this.walPath);
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        if (fs.existsSync(this.walPath)) {
            const lines = fs.readFileSync(this.walPath, 'utf8').split('\n').filter(Boolean);
            const last = lines[lines.length - 1];
            if (last) {
                try {
                    const entry = JSON.parse(last);
                    this.seq = entry.seq + 1;
                }
                catch {
                    /* malformed last line — safe to ignore */
                }
            }
        }
    }
    /**
     * Append a WAL entry synchronously.
     */
    append(op, jobId, data) {
        const entry = {
            seq: this.seq++,
            op,
            jobId,
            timestamp: Date.now(),
            data,
        };
        if (this.enabled) {
            fs.appendFileSync(this.walPath, JSON.stringify(entry) + '\n', 'utf8');
        }
        return entry;
    }
    /**
     * Read all WAL entries from disk.
     */
    readAll() {
        if (!this.enabled || !fs.existsSync(this.walPath))
            return [];
        const lines = fs.readFileSync(this.walPath, 'utf8').split('\n').filter(Boolean);
        return lines.map((line) => JSON.parse(line));
    }
    /**
     * Read WAL entries after a given sequence number (for post-snapshot replay).
     */
    readAfter(seq) {
        return this.readAll().filter((e) => e.seq > seq);
    }
    /**
     * Truncate the WAL (called after snapshot is persisted).
     */
    truncate() {
        if (!this.enabled)
            return;
        fs.writeFileSync(this.walPath, '', 'utf8');
        this.seq = 0;
    }
    get currentSeq() {
        return this.seq;
    }
}
exports.WALWriter = WALWriter;
