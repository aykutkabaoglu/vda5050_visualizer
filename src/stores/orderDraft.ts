import { defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";
import type { Ref } from "vue";
import type { AgvId } from "@/types/vda5050.types";
import {
  appendNode,
  removeLastNode,
  relinkChain,
  removeNodeAt,
  releaseUpTo as releaseChainUpTo,
  type NewNode,
  type OrderChain,
} from "@/utils/order-draft";

/**
 * The order being edited in the order publisher, shared with the graph so it
 * can be previewed and drawn on the map.
 */
export const useOrderDraftStore = defineStore("orderDraft", () => {
  // Held in an object so the form ref is stored as is, not unwrapped
  const form = shallowRef<{ ref: Ref<OrderChain> } | null>(null);
  const agvId = ref<AgvId | null>(null);
  /** Clicks on the graph add nodes */
  const drawMode = ref(false);
  /** Node selected on the graph, highlighted in the form */
  const selectedIndex = ref<number | null>(null);
  /** Leading nodes that must not change (the stitching node of an update) */
  const lockedCount = ref(0);

  const chain = computed<OrderChain | null>(
    () => form.value?.ref.value ?? null
  );

  function attach(orderForm: Ref<OrderChain>, id: AgvId) {
    form.value = { ref: orderForm };
    agvId.value = id;
    lockedCount.value = 0;
    drawMode.value = false;
    selectedIndex.value = null;
  }

  function detach(orderForm: Ref<OrderChain>) {
    if (form.value?.ref !== orderForm) return;
    form.value = null;
    agvId.value = null;
    drawMode.value = false;
    selectedIndex.value = null;
  }

  function addNode(newNode: NewNode) {
    if (!chain.value) return;
    appendNode(chain.value, newNode);
    selectedIndex.value = chain.value.nodes.length - 1;
  }

  function undoLastNode() {
    if (!chain.value || chain.value.nodes.length <= lockedCount.value) return;
    removeLastNode(chain.value);
    selectedIndex.value = null;
  }

  /** Removes a node and its edge; the locked stitching node stays */
  function removeNode(index: number) {
    if (!chain.value || index < lockedCount.value) return;
    removeNodeAt(chain.value, index);
    selectedIndex.value = null;
  }

  function relink() {
    if (chain.value) relinkChain(chain.value);
  }

  /** Nodes up to index become the base, the rest the horizon */
  function releaseUpTo(index: number) {
    if (chain.value) releaseChainUpTo(chain.value, index);
  }

  function moveNode(index: number, x: number, y: number) {
    if (index < lockedCount.value) return;
    const node = chain.value?.nodes[index];
    if (!node) return;
    const round = (value: number) => Math.round(value * 1000) / 1000;
    node.nodePosition = {
      ...(node.nodePosition ?? { mapId: "" }),
      x: round(x),
      y: round(y),
    };
  }

  function setTheta(index: number, theta: number) {
    if (index < lockedCount.value) return;
    const node = chain.value?.nodes[index];
    if (!node?.nodePosition) return;
    node.nodePosition = { ...node.nodePosition, theta };
  }

  return {
    agvId,
    drawMode,
    selectedIndex,
    lockedCount,
    chain,
    attach,
    detach,
    addNode,
    undoLastNode,
    relink,
    removeNode,
    releaseUpTo,
    moveNode,
    setTheta,
  };
});
