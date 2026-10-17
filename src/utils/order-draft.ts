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
  x: number;
  y: number;
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
  const nodePosition: NonNullable<Node["nodePosition"]> = {
    x: newNode.x,
    y: newNode.y,
    mapId: newNode.mapId,
  };
  if (newNode.theta !== undefined) nodePosition.theta = newNode.theta;

  const node: Node = {
    nodeId:
      newNode.nodeId ??
      uniqueId("node", new Set(chain.nodes.map((n) => n.nodeId))),
    sequenceId: previous ? previous.sequenceId + 2 : 0,
    released,
    nodePosition,
    actions: [],
  };
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
 * Makes nodes 0..index and the edges between them the base and everything
 * after them the horizon.
 */
export function releaseUpTo(chain: OrderChain, index: number) {
  chain.nodes.forEach((node, i) => {
    node.released = i <= index;
  });
  chain.edges.forEach((edge, i) => {
    edge.released = i + 1 <= index;
  });
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
