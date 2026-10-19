import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

/**
 * Orders saved from the order publisher. The browser cannot write files, so
 * the Vite dev/preview server keeps them in one JSON file in the package
 * folder (saved-orders.json, ignored by git).
 */

export const API_PATH = "/api/saved-orders";
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_NAME_LENGTH = 100;

export interface SavedOrder {
  name: string;
  savedAt: string;
  manufacturer: string;
  serialNumber: string;
  /** Order message without header fields (nodes, edges, orderId, ...) */
  order: {
    orderId?: string;
    version?: string;
    zoneSetId?: string;
    nodes: unknown[];
    edges: unknown[];
  };
}

interface StoreFile {
  version: 1;
  orders: SavedOrder[];
}

export function readSavedOrders(file: string): SavedOrder[] {
  if (!fs.existsSync(file)) return [];
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as StoreFile;
  return Array.isArray(data?.orders) ? data.orders : [];
}

/** Writes via a temporary file so a crash never leaves a half-written file */
function writeSavedOrders(file: string, orders: SavedOrder[]) {
  const data: StoreFile = { version: 1, orders };
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

/** Validates a saved order from a request; returns an error message or null */
export function validateSavedOrder(entry: any): string | null {
  if (!entry || typeof entry !== "object") return "Body must be an object";
  if (typeof entry.name !== "string" || entry.name.trim() === "") {
    return "name is required";
  }
  if (entry.name.length > MAX_NAME_LENGTH) {
    return `name is longer than ${MAX_NAME_LENGTH} characters`;
  }
  const order = entry.order;
  if (!order || !Array.isArray(order.nodes) || !Array.isArray(order.edges)) {
    return "order with nodes and edges is required";
  }
  return null;
}

/** Saves an order, replacing a saved order with the same name */
export function saveOrder(file: string, entry: SavedOrder): SavedOrder[] {
  const orders = readSavedOrders(file).filter((o) => o.name !== entry.name);
  orders.push(entry);
  orders.sort((a, b) => a.name.localeCompare(b.name));
  writeSavedOrders(file, orders);
  return orders;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/** Request handler for GET (list) and POST (save) on API_PATH */
export function createSavedOrdersHandler(file: string) {
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void
  ) => {
    const url = (req.url ?? "").split("?")[0];
    if (url !== API_PATH) return next();
    try {
      if (req.method === "GET") {
        return send(res, 200, { orders: readSavedOrders(file) });
      }
      if (req.method === "POST") {
        const entry = JSON.parse(await readBody(req));
        const error = validateSavedOrder(entry);
        if (error) return send(res, 400, { error });
        const saved: SavedOrder = {
          name: entry.name.trim(),
          savedAt: new Date().toISOString(),
          manufacturer: String(entry.manufacturer ?? ""),
          serialNumber: String(entry.serialNumber ?? ""),
          order: entry.order,
        };
        return send(res, 200, { orders: saveOrder(file, saved) });
      }
      return send(res, 405, { error: "Method not allowed" });
    } catch (error) {
      return send(res, 500, { error: (error as Error).message });
    }
  };
}

/** Vite plugin serving the saved orders in dev and preview mode */
export function savedOrdersPlugin(root: string): Plugin {
  const file = path.join(root, "saved-orders.json");
  const handler = createSavedOrdersHandler(file);
  return {
    name: "vda5050-saved-orders",
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
