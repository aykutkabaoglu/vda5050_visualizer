import { computed } from "vue";
import type { Edges, Layouts, Nodes } from "v-network-graph";
import { useOrderDraftStore } from "@/stores/orderDraft";
import { useMqttStore } from "@/stores/mqtt";
import {
  decisionPointIndex,
  defaultMapId as defaultMapIdOf,
  edgeEndpoints,
  edgeIssues,
  type NewNode,
} from "@/utils/order-draft";

const DRAFT_NODE_PREFIX = "draft:";
const DRAFT_EDGE_PREFIX = "draft-edge:";
const ROBOT_NODE_PREFIX = "robot_";

export const DRAFT_COLOR = "#f97316";
/** Horizon (unreleased) nodes and edges of the draft */
export const DRAFT_HORIZON_COLOR = "#fdba74";
export const DRAFT_SELECTED_COLOR = "#7c3aed";
export const DRAFT_ERROR_COLOR = "#dc2626";

export function draftNodeKey(index: number) {
  return `${DRAFT_NODE_PREFIX}${index}`;
}

/** Index of a draft node from its graph key, null for other nodes */
export function draftIndexOf(key: string): number | null {
  return key.startsWith(DRAFT_NODE_PREFIX)
    ? Number(key.slice(DRAFT_NODE_PREFIX.length))
    : null;
}

/**
 * Graph nodes, edges and layouts of the order draft, and the map positions
 * of other graph nodes that can be reused in it.
 */
export function useOrderDraftGraph() {
  const draft = useOrderDraftStore();
  const mqttStore = useMqttStore();

  const nodes = computed<Nodes>(() => {
    const result: Nodes = {};
    const chain = draft.chain;
    const decisionPoint = chain ? decisionPointIndex(chain) : -1;
    chain?.nodes.forEach((node, index) => {
      if (!node.nodePosition) return;
      const selected = draft.selectedIndex === index;
      const decision =
        index === decisionPoint && decisionPoint < chain.nodes.length - 1;
      result[draftNodeKey(index)] = {
        name: `${node.nodeId} (${node.sequenceId})${
          decision ? " · decision point" : ""
        }`,
        color: selected
          ? DRAFT_SELECTED_COLOR
          : node.released
          ? DRAFT_COLOR
          : DRAFT_HORIZON_COLOR,
        zIndex: selected ? 60 : 50,
        draft: true,
        locked: index < draft.lockedCount,
      };
    });
    return result;
  });

  const layouts = computed<Layouts["nodes"]>(() => {
    const result: Layouts["nodes"] = {};
    draft.chain?.nodes.forEach((node, index) => {
      if (!node.nodePosition) return;
      result[draftNodeKey(index)] = {
        x: node.nodePosition.x,
        y: -node.nodePosition.y,
      };
    });
    return result;
  });

  const edges = computed<Edges>(() => {
    const result: Edges = {};
    const chain = draft.chain;
    chain?.edges.forEach((edge, index) => {
      // Drawn between the nodes the edge names, so manual branches show up
      const endpoints = edgeEndpoints(chain, index);
      if (!endpoints) return;
      const [startIndex, endIndex] = endpoints;
      if (
        !chain.nodes[startIndex].nodePosition ||
        !chain.nodes[endIndex].nodePosition
      ) {
        return;
      }
      const issues = edgeIssues(chain, index);
      // Edges are drawn from end to start so the arrow marker sits at the end
      result[`${DRAFT_EDGE_PREFIX}${index}`] = {
        source: draftNodeKey(endIndex),
        target: draftNodeKey(startIndex),
        color:
          issues.length > 0
            ? DRAFT_ERROR_COLOR
            : edge.released
            ? DRAFT_COLOR
            : DRAFT_HORIZON_COLOR,
        // Base edges solid, horizon edges dashed
        dasharray: edge.released ? "none" : "8 6",
        label:
          issues.length > 0
            ? `${edge.edgeId} (${issues.join(", ")})`
            : edge.edgeId,
      };
    });
    return result;
  });

  /** Heading arrows of the draft nodes, in graph coordinates */
  const headings = computed(() =>
    (draft.chain?.nodes ?? []).flatMap((node, index) =>
      node.nodePosition && index >= draft.lockedCount
        ? [
            {
              index,
              x: node.nodePosition.x,
              y: -node.nodePosition.y,
              theta: node.nodePosition.theta,
            },
          ]
        : []
    )
  );

  function draftAgvData() {
    const id = draft.agvId;
    if (!id) return undefined;
    return mqttStore.agvDataMap.get(`${id.manufacturer}/${id.serialNumber}`);
  }

  /** mapId for a new node: the AGV's current map, else the previous node's */
  function defaultMapId(): string {
    return defaultMapIdOf(
      draft.chain,
      draftAgvData()?.stateInfo?.agvPosition?.mapId
    );
  }

  /**
   * A node to append when an existing graph node is clicked in draw mode:
   * a draft node again (loops), a node of a received order, or a robot
   * (its current pose, with its lastNodeId when known).
   */
  function nodeFromGraphKey(key: string): NewNode | null {
    const index = draftIndexOf(key);
    if (index !== null) {
      const node = draft.chain?.nodes[index];
      if (!node?.nodePosition) return null;
      return {
        nodeId: node.nodeId,
        x: node.nodePosition.x,
        y: node.nodePosition.y,
        theta: node.nodePosition.theta,
        mapId: node.nodePosition.mapId,
      };
    }

    if (key.startsWith(ROBOT_NODE_PREFIX)) {
      const serial = key.slice(ROBOT_NODE_PREFIX.length);
      const agv = mqttStore.agvList.find(
        (data) => data.agvId.serialNumber === serial
      );
      const position =
        agv?.stateInfo?.agvPosition ?? agv?.visualizationInfo?.agvPosition;
      if (!position) return null;
      return {
        nodeId: agv?.stateInfo?.lastNodeId || undefined,
        x: position.x,
        y: position.y,
        theta: position.theta,
        mapId: position.mapId ?? defaultMapId(),
      };
    }

    for (const agv of mqttStore.agvList) {
      const node = agv.orderInfo?.nodes?.find(
        (candidate: any) => candidate.nodeId === key
      );
      if (node?.nodePosition) {
        return {
          nodeId: node.nodeId,
          x: node.nodePosition.x,
          y: node.nodePosition.y,
          theta: node.nodePosition.theta,
          mapId: node.nodePosition.mapId,
        };
      }
    }
    return null;
  }

  return {
    draft,
    nodes,
    edges,
    layouts,
    headings,
    defaultMapId,
    nodeFromGraphKey,
  };
}
