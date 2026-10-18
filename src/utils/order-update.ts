import type { Edge, Node } from "vda-5050-lib";
import { relinkChain, type OrderChain } from "@/utils/order-draft";

/** The parts of a VDA5050 state message needed to continue an order */
export interface RobotOrderState {
  version?: string;
  orderId?: string;
  orderUpdateId?: number;
  lastNodeId?: string;
  lastNodeSequenceId?: number;
  nodeStates?: Array<{
    nodeId: string;
    sequenceId: number;
    nodeDescription?: string;
    nodePosition?: Node["nodePosition"];
    released: boolean;
  }>;
  edgeStates?: Array<{ edgeId: string; sequenceId: number }>;
  actionStates?: Array<{ actionStatus?: string }>;
  agvPosition?: { x: number; y: number; theta?: number; mapId?: string };
}

/**
 * An order is active while it has nodes left (base or horizon) or actions
 * that are neither FINISHED nor FAILED (VDA5050 2.1.0, 6.6.2, Figure 8).
 */
export function isOrderActive(state: RobotOrderState | null | undefined) {
  if (!state?.orderId) return false;
  const nodesLeft = (state.nodeStates?.length ?? 0) > 0;
  const actionsLeft = (state.actionStates ?? []).some(
    (action) =>
      action.actionStatus !== "FINISHED" && action.actionStatus !== "FAILED"
  );
  return nodesLeft || actionsLeft;
}

/** A copy, so editing the order does not change the received state */
function copyPosition(position: Node["nodePosition"]) {
  return position ? { ...position } : undefined;
}

/** Position of the robot as a node position */
function robotNodePosition(
  state: RobotOrderState
): Node["nodePosition"] | undefined {
  const position = state.agvPosition;
  if (!position) return undefined;
  const nodePosition: NonNullable<Node["nodePosition"]> = {
    x: position.x,
    y: position.y,
    mapId: position.mapId ?? "",
  };
  if (position.theta !== undefined) nodePosition.theta = position.theta;
  return nodePosition;
}

/**
 * The robot's last node as the first node of a new order, placed at the
 * robot's current position.
 */
export function lastNodeAsStart(state: RobotOrderState): Node | null {
  if (!state.lastNodeId) return null;
  return {
    nodeId: state.lastNodeId,
    sequenceId: 0,
    released: true,
    nodePosition: robotNodePosition(state),
    actions: [],
  };
}

/** Puts a node at the start of the chain and reconnects it */
export function insertStartNode(chain: OrderChain, node: Node) {
  chain.nodes.unshift(node);
  relinkChain(chain); // numbers the chain from the new node's sequenceId
}

export interface OrderUpdate extends OrderChain {
  orderId: string;
  orderUpdateId: number;
  /** Where the first (stitching) node comes from */
  stitching: "decisionPoint" | "lastNode";
}

/**
 * The start of an order update (VDA5050 2.1.0, 6.6.2): the stitching node
 * followed by the current horizon, all unreleased. While base nodes are left
 * the stitching node is the decision point (last released node state),
 * otherwise the last traversed node (lastNodeId, lastNodeSequenceId) at the
 * robot's position. Node actions are not part of the state, so horizon nodes
 * come without actions.
 */
export function buildOrderUpdate(state: RobotOrderState): OrderUpdate | null {
  if (!state.orderId) return null;
  const nodeStates = [...(state.nodeStates ?? [])].sort(
    (a, b) => a.sequenceId - b.sequenceId
  );
  const released = nodeStates.filter((node) => node.released);
  const decisionPoint = released[released.length - 1];

  let stitchingNode: Node;
  if (decisionPoint) {
    stitchingNode = {
      nodeId: decisionPoint.nodeId,
      sequenceId: decisionPoint.sequenceId,
      released: true,
      nodePosition: copyPosition(decisionPoint.nodePosition),
      actions: [],
    };
  } else {
    if (!state.lastNodeId) return null;
    stitchingNode = {
      nodeId: state.lastNodeId,
      sequenceId: state.lastNodeSequenceId ?? 0,
      released: true,
      nodePosition: robotNodePosition(state),
      actions: [],
    };
  }

  const horizon: Node[] = nodeStates
    .filter((node) => node.sequenceId > stitchingNode.sequenceId)
    .map((node) => {
      const result: Node = {
        nodeId: node.nodeId,
        sequenceId: node.sequenceId,
        released: false,
        nodePosition: copyPosition(node.nodePosition),
        actions: [],
      };
      if (node.nodeDescription) result.nodeDescription = node.nodeDescription;
      return result;
    });

  const nodes = [stitchingNode, ...horizon];
  // Keep the edge ids the robot reports; relinkChain sets the rest
  const edges: Edge[] = nodes.slice(1).map((node) => {
    const edgeState = state.edgeStates?.find(
      (edge) => edge.sequenceId === node.sequenceId - 1
    );
    return {
      edgeId: edgeState?.edgeId ?? "",
      sequenceId: 0,
      startNodeId: "",
      endNodeId: "",
      released: false,
      actions: [],
    };
  });
  const chain: OrderChain = { nodes, edges };
  relinkChain(chain);
  chain.edges.forEach((edge, index) => {
    if (!edge.edgeId) edge.edgeId = `edge_${edge.sequenceId}_${index + 1}`;
  });

  return {
    orderId: state.orderId,
    orderUpdateId: (state.orderUpdateId ?? 0) + 1,
    stitching: decisionPoint ? "decisionPoint" : "lastNode",
    ...chain,
  };
}
