import { Worker } from "node:worker_threads";
import { ENGINE_VERSIONS, RESOURCE_LIMITS } from "@panelstudio/contracts";
import { hashFigureDocument } from "@panelstudio/core";
import { ApiException } from "./http.js";
import type { RenderSnapshot, RenderedPng, RenderTask } from "./render-task.js";

export const PNG_RENDERER = "resvg-js@2.6.2";
const MAX_CACHED_BYTES = 32 * 1024 * 1024;

type Work = { task: RenderTask; resolve: (result: RenderedPng) => void; reject: (error: Error) => void };
type Slot = { worker: Worker; work?: Work };

export class RenderPool {
  private slots = new Set<Slot>();
  private queue: Work[] = [];
  private closed = false;
  private cached = new Map<string, RenderedPng>();
  private pending = new Map<string, Promise<RenderedPng>>();
  private cacheBytes = 0;

  render(snapshot: RenderSnapshot, pixelWidth: number): Promise<RenderedPng> {
    const { document } = snapshot;
    const pixelHeight = Math.max(1, Math.round(pixelWidth * document.canvas.heightMm / document.canvas.widthMm));
    if (pixelWidth < 1 || !Number.isInteger(pixelWidth) || pixelWidth > RESOURCE_LIMITS.maxPngOutputEdgePx ||
        pixelHeight > RESOURCE_LIMITS.maxPngOutputEdgePx || pixelWidth * pixelHeight > RESOURCE_LIMITS.maxPngOutputPixels) {
      throw new ApiException("EXPORT_TOO_LARGE", "The render exceeds the pixel limit.");
    }
    if (this.closed) return Promise.reject(new Error("Renderer is closed."));
    const sources = Object.entries(snapshot.assets).sort(([a], [b]) => a.localeCompare(b))
      .map(([id, asset]) => [id, asset.normalized.renderSha256]);
    const key = JSON.stringify([hashFigureDocument(document), sources, pixelWidth, pixelHeight,
      PNG_RENDERER, ENGINE_VERSIONS.svg, ENGINE_VERSIONS.fontRegistry]);
    const hit = this.cached.get(key);
    if (hit) {
      this.cached.delete(key);
      this.cached.set(key, hit);
      return Promise.resolve(hit);
    }
    const running = this.pending.get(key);
    if (running) return running;
    const promise = new Promise<RenderedPng>((resolve, reject) => {
      this.queue.push({ task: { snapshot, pixelWidth }, resolve, reject });
      this.pump();
    }).then((result) => {
      if (!this.closed && result.bytes.byteLength <= MAX_CACHED_BYTES) {
        this.cached.set(key, result);
        this.cacheBytes += result.bytes.byteLength;
        while (this.cacheBytes > MAX_CACHED_BYTES) {
          const [oldKey, old] = this.cached.entries().next().value!;
          this.cached.delete(oldKey);
          this.cacheBytes -= old.bytes.byteLength;
        }
      }
      return result;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }

  private pump(): void {
    while (this.queue.length && !this.closed) {
      let slot = [...this.slots].find((item) => !item.work);
      if (!slot && this.slots.size >= 2) return;
      if (!slot) {
        const worker = new Worker(new URL("./render-worker.mjs", import.meta.url), { execArgv: [] });
        const created: Slot = { worker };
        this.slots.add(created);
        worker.on("message", (message: RenderedPng | { error: string }) => {
          const work = created.work;
          created.work = undefined;
          if ("error" in message) work?.reject(new Error(message.error));
          else work?.resolve(message);
          this.pump();
        });
        const failed = (error: Error) => {
          if (!this.slots.delete(created)) return;
          created.work?.reject(error);
          this.pump();
        };
        worker.once("error", failed);
        worker.once("exit", () => failed(new Error("Render worker stopped.")));
        slot = created;
      }
      slot.work = this.queue.shift()!;
      slot.worker.postMessage(slot.work.task);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    const stopped = new Error("Renderer is closing.");
    for (const work of this.queue.splice(0)) work.reject(stopped);
    for (const slot of this.slots) slot.work?.reject(stopped);
    await Promise.all([...this.slots].map(({ worker }) => worker.terminate()));
    this.cached.clear();
    this.cacheBytes = 0;
  }
}
