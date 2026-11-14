// Some wallet packages expect Node globals in the browser.
import { Buffer } from "buffer";
if (!globalThis.Buffer) globalThis.Buffer = Buffer;
if (!globalThis.process) globalThis.process = { env: {}, browser: true, version: "", versions: {}, nextTick: (fn, ...a) => queueMicrotask(() => fn(...a)) };
if (!globalThis.process.env) globalThis.process.env = {};
