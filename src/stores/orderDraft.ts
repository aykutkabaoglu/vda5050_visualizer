import { defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";
import type { Ref } from "vue";
import type { AgvId } from "@/types/vda5050.types";
import {
  appendNode,
  removeLastNode,
  relinkChain,
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

  const chain = computed<OrderChain | null>(
    () => form.value?.ref.value ?? null
  );

  function attach(orderForm: Ref<OrderChain>, id: AgvId) {
    form.value = { ref: orderForm };
    agvId.value = id;
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
    if (!chain.value) return;
    removeLastNode(chain.value);
    selectedIndex.value = null;
  }

  function relink() {
    if (chain.value) relinkChain(chain.value);
  }

  function moveNode(index: number, x: number, y: number) {
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
    const node = chain.value?.nodes[index];
    if (!node?.nodePosition) return;
    node.nodePosition = { ...node.nodePosition, theta };
  }

  return {
    agvId,
    drawMode,
    selectedIndex,
    chain,
    attach,
    detach,
    addNode,
    undoLastNode,
    relink,
    moveNode,
    setTheta,
  };
});
