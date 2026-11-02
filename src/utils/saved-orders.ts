import type { Edge, Node } from "vda-5050-lib";

/**
 * Orders saved by the dev/preview server in saved-orders.json in the package
 * folder (see server/saved-orders.ts).
 */
const API_PATH = "/api/saved-orders";

export interface SavedOrder {
  name: string;
  savedAt: string;
  manufacturer: string;
  serialNumber: string;
  order: {
    orderId?: string;
    version?: string;
    zoneSetId?: string;
    nodes: Node[];
    edges: Edge[];
  };
}

/** The parts of the order form that are saved */
export interface SavableOrder {
  orderId: string;
  version: string;
  zoneSetId?: string;
  nodes: Node[];
  edges: Edge[];
}

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

async function request(init?: RequestInit): Promise<SavedOrder[]> {
  let response: Response;
  try {
    response = await fetch(API_PATH, init);
  } catch {
    throw new Error("The server for saved orders cannot be reached");
  }
  const isJson = response.headers
    .get("Content-Type")
    ?.includes("application/json");
  if (!isJson) {
    // e.g. the built app or Electron, where no dev/preview server runs
    throw new Error(
      "Saved orders need the visualizer's dev or preview server (npm run dev)"
    );
  }
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? response.statusText);
  return body.orders as SavedOrder[];
}

export function fetchSavedOrders(): Promise<SavedOrder[]> {
  return request();
}

/** Saves an order under a name, replacing a saved order with that name */
export function saveOrder(
  name: string,
  agvId: { manufacturer: string; serialNumber: string },
  order: SavableOrder
): Promise<SavedOrder[]> {
  const body = {
    name,
    manufacturer: agvId.manufacturer,
    serialNumber: agvId.serialNumber,
    order: copy({
      orderId: order.orderId,
      version: order.version,
      zoneSetId: order.zoneSetId || undefined,
      nodes: order.nodes,
      edges: order.edges,
    }),
  };
  return request({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Nodes and edges of a saved order, as copies for the form */
export function savedOrderContents(saved: SavedOrder) {
  return {
    nodes: copy(saved.order.nodes ?? []),
    edges: copy(saved.order.edges ?? []),
    zoneSetId: saved.order.zoneSetId ?? "",
  };
}
