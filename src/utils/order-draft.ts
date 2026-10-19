import type { Edge, Node } from "vda-5050-lib";

/**
 * The part of an order that forms its path. Nodes and edges alternate:
 * edge i goes from node i to node i + 1, nodes have even and edges odd
 * sequence ids (VDA5050 2.1.0, 6.6.3).
 */
export interface OrderChain {
  nodes: Node[];
  edges: Edge[];
}

export interface NewNode {
  /** Reuse this nodeId (e.g. an existing node); a new id is generated otherwise */
  nodeId?: string;
  /** Without x and y the node has no position yet */
  x?: number;
  y?: number;
  theta?: number;
  mapId: string;
}

function uniqueId(prefix: string, used: Set<string>): string {
  let index = used.size + 1;
  while (used.has(`${prefix}_${index}`)) index++;
  return `${prefix}_${index}`;
}

/** Appends a node at the end of the chain and the edge leading to it. */
export function appendNode(chain: OrderChain, newNode: NewNode): Node {
  const previous = chain.nodes[chain.nodes.length - 1];
  // A node after a horizon (unreleased) node is part of the horizon as well
  const released = previous ? previous.released : true;
  const node: Node = {
    nodeId:
      newNode.nodeId ??
      uniqueId("node", new Set(chain.nodes.map((n) => n.nodeId))),
    sequenceId: previous ? previous.sequenceId + 2 : 0,
    released,
    actions: [],
  };
  if (newNode.x !== undefined && newNode.y !== undefined) {
    node.nodePosition = { x: newNode.x, y: newNode.y, mapId: newNode.mapId };
    if (newNode.theta !== undefined) node.nodePosition.theta = newNode.theta;
  }
  chain.nodes.push(node);

  if (previous) {
    chain.edges.push({
      edgeId: uniqueId("edge", new Set(chain.edges.map((e) => e.edgeId))),
      sequenceId: previous.sequenceId + 1,
      startNodeId: previous.nodeId,
      endNodeId: node.nodeId,
      released,
      actions: [],
    });
  }
  return node;
}

/** Removes the last node and the edge leading to it. */
export function removeLastNode(chain: OrderChain) {
  chain.nodes.pop();
  if (chain.edges.length > Math.max(chain.nodes.length - 1, 0)) {
    chain.edges.pop();
  }
}

/**
 * Removes a node. In a valid chain its edge is removed as well and the chain
 * is reconnected. Otherwise (e.g. manually added branches) only the edges
 * that start or end at the node are removed and nothing is renumbered.
 */
export function removeNodeAt(chain: OrderChain, index: number) {
  if (index < 0 || index >= chain.nodes.length) return;
  if (chainIssues(chain).length === 0) {
    chain.nodes.splice(index, 1);
    if (chain.edges.length > 0) {
      chain.edges.splice(Math.max(index - 1, 0), 1);
    }
    relinkChain(chain);
    return;
  }
  const [removed] = chain.nodes.splice(index, 1);
  const stillUsed = chain.nodes.some((node) => node.nodeId === removed.nodeId);
  if (!stillUsed) {
    chain.edges = chain.edges.filter(
      (edge) =>
        edge.startNodeId !== removed.nodeId && edge.endNodeId !== removed.nodeId
    );
  }
}

/**
 * Adds an edge by hand, e.g. for a branch. It starts at the last node; the
 * end node is chosen in the form. Its sequenceId follows the highest one in
 * the order.
 */
export function addManualEdge(chain: OrderChain): Edge {
  const highest = Math.max(
    -1,
    ...chain.nodes.map((node) => node.sequenceId),
    ...chain.edges.map((edge) => edge.sequenceId)
  );
  const edge: Edge = {
    edgeId: uniqueId("edge", new Set(chain.edges.map((e) => e.edgeId))),
    sequenceId: highest + 1,
    startNodeId: chain.nodes[chain.nodes.length - 1]?.nodeId ?? "",
    endNodeId: "",
    released: true,
    actions: [],
  };
  chain.edges.push(edge);
  return edge;
}

/**
 * Indices of the nodes edge i connects. In a chain these are i and i + 1;
 * otherwise the nodes are found by id (preferring the ones whose sequenceId
 * is next to the edge's). Null when a node id is not in the order.
 */
export function edgeEndpoints(
  chain: OrderChain,
  index: number
): [number, number] | null {
  const edge = chain.edges[index];
  if (!edge) return null;
  if (
    chain.nodes[index]?.nodeId === edge.startNodeId &&
    chain.nodes[index + 1]?.nodeId === edge.endNodeId
  ) {
    return [index, index + 1];
  }
  const find = (nodeId: string, sequenceId: number, exclude = -1) => {
    const matches = chain.nodes
      .map((node, i) => ({ node, i }))
      .filter(({ node, i }) => node.nodeId === nodeId && i !== exclude);
    return (
      matches.find(({ node }) => node.sequenceId === sequenceId)?.i ??
      matches[0]?.i ??
      -1
    );
  };
  const start = find(edge.startNodeId, edge.sequenceId - 1);
  const end = find(edge.endNodeId, edge.sequenceId + 1, start);
  return start >= 0 && end >= 0 ? [start, end] : null;
}

/**
 * mapId for a new node: the map the robot reports in its state, else the
 * previous node's map.
 */
export function defaultMapId(
  chain: OrderChain | null | undefined,
  stateMapId: string | null | undefined
): string {
  if (stateMapId) return stateMapId;
  const nodes = chain?.nodes ?? [];
  return nodes[nodes.length - 1]?.nodePosition?.mapId ?? "";
}

/**
 * Makes the chain consistent after manual edits: renumbers sequence ids,
 * adds or removes edges so there is one between each pair of consecutive
 * nodes, and points every edge at its nodes. Existing edges keep their
 * ids, actions and other fields.
 */
export function relinkChain(chain: OrderChain) {
  const base = chain.nodes[0]?.sequenceId ?? 0;
  chain.nodes.forEach((node, index) => {
    node.sequenceId = base + 2 * index;
  });

  const needed = Math.max(chain.nodes.length - 1, 0);
  chain.edges.splice(needed);
  while (chain.edges.length < needed) {
    chain.edges.push({
      edgeId: uniqueId("edge", new Set(chain.edges.map((e) => e.edgeId))),
      sequenceId: 0,
      startNodeId: "",
      endNodeId: "",
      released: true,
      actions: [],
    });
  }
  chain.edges.forEach((edge, index) => {
    const start = chain.nodes[index];
    const end = chain.nodes[index + 1];
    edge.sequenceId = start.sequenceId + 1;
    edge.startNodeId = start.nodeId;
    edge.endNodeId = end.nodeId;
    edge.released = start.released && end.released;
  });
}

/** Problems of edge i, empty when it joins node i and node i + 1 correctly */
export function edgeIssues(chain: OrderChain, index: number): string[] {
  const edge = chain.edges[index];
  const start = chain.nodes[index];
  const end = chain.nodes[index + 1];
  if (!edge) return [];
  if (!start || !end) return ["No node after this edge"];

  const issues: string[] = [];
  if (edge.startNodeId !== start.nodeId) issues.push("startNodeId");
  if (edge.endNodeId !== end.nodeId) issues.push("endNodeId");
  if (
    edge.sequenceId !== start.sequenceId + 1 ||
    edge.sequenceId !== end.sequenceId - 1
  ) {
    issues.push("sequenceId");
  }
  // An edge is released only with both its nodes, and nothing released
  // follows an unreleased edge (VDA5050 2.1.0, 6.6.1)
  if (edge.released && !(start.released && end.released)) {
    issues.push("released");
  }
  if (!edge.released && end.released) {
    issues.push("base after horizon");
  }
  return issues;
}

/**
 * Index of the decision point, the last node of the base (VDA5050 2.1.0,
 * 6.6.2); -1 when the first node is not released.
 */
export function decisionPointIndex(chain: OrderChain): number {
  let index = -1;
  while (index + 1 < chain.nodes.length && chain.nodes[index + 1].released) {
    index++;
  }
  return index;
}

/**
 * Sets each edge's released flag from its nodes: an edge is released exactly
 * when its start and end node are (VDA5050 2.1.0, 6.6.1: an edge can be
 * released only with both its nodes, and nothing released follows an
 * unreleased edge). Edges whose nodes are not in the order are unreleased.
 */
export function syncEdgeReleased(chain: OrderChain) {
  chain.edges.forEach((edge, index) => {
    const endpoints = edgeEndpoints(chain, index);
    edge.released = endpoints
      ? chain.nodes[endpoints[0]].released && chain.nodes[endpoints[1]].released
      : false;
  });
}

/**
 * Makes nodes 0..index the base and the nodes after them the horizon; the
 * edges follow their nodes.
 */
export function releaseUpTo(chain: OrderChain, index: number) {
  chain.nodes.forEach((node, i) => {
    node.released = i <= index;
  });
  syncEdgeReleased(chain);
}

/**
 * Releases or unreleases a node while keeping the base a prefix of the
 * order: releasing node i releases all nodes before it, unreleasing it moves
 * it and all nodes after it to the horizon.
 */
export function setNodeReleased(
  chain: OrderChain,
  index: number,
  released: boolean
) {
  releaseUpTo(chain, released ? index : index - 1);
}

/** Problems of the whole chain, for a summary next to the form */
export function chainIssues(chain: OrderChain): string[] {
  const issues: string[] = [];
  const needed = Math.max(chain.nodes.length - 1, 0);
  if (chain.edges.length !== needed) {
    issues.push(
      `${chain.edges.length} edges for ${chain.nodes.length} nodes (needs ${needed})`
    );
  }
  chain.edges.forEach((edge, index) => {
    const problems = edgeIssues(chain, index);
    if (problems.length > 0) {
      issues.push(`${edge.edgeId}: ${problems.join(", ")}`);
    }
  });
  return issues;
}

/** Heading in radians from a map position to another, rounded to 0.01 */
export function headingTo(
  from: { x: number; y: number },
  to: { x: number; y: number },
  snapDegrees = 0
): number {
  let theta = Math.atan2(to.y - from.y, to.x - from.x);
  if (snapDegrees > 0) {
    const step = (snapDegrees * Math.PI) / 180;
    theta = Math.round(theta / step) * step;
    if (theta > Math.PI) theta -= 2 * Math.PI;
  }
  return Math.round(theta * 100) / 100;
}
