<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  unref,
  watch,
} from "vue";
import type { Ref } from "vue";
import { useVDA5050 } from "@/composables/useVDA5050";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@iconify/vue";
import { useToast } from "@/components/ui/toast";
import { generateManhattanRoute } from "@/utils/manhattan-route";
import type { Order, Node, Edge } from "vda-5050-lib";
import { BlockingType as BlockingTypeEnum } from "@/types/vda5050.types";
import ActionEditor from "@/components/ActionEditor.vue";
import FactsheetStatus from "@/components/FactsheetStatus.vue";
import { useFactsheet } from "@/composables/useFactsheet";
import { useOrderDraftStore } from "@/stores/orderDraft";
import {
  fetchSavedOrders,
  saveOrder as saveOrderFile,
  savedOrderContents,
  type SavedOrder,
} from "@/utils/saved-orders";
import { useMqttStore } from "@/stores/mqtt";
import {
  buildOrderUpdate,
  insertStartNode,
  isOrderActive,
  lastNodeAsStart,
} from "@/utils/order-update";
import {
  chainIssues,
  decisionPointIndex,
  defaultMapId,
  type OrderChain,
} from "@/utils/order-draft";

const props = defineProps<{
  agvId: { manufacturer: string; serialNumber: string };
  existingOrder?: Order | null;
}>();

const emit = defineEmits<{
  close: [];
  published: [];
}>();

const { agvControllers, interfaceName } = useVDA5050();
const { toast } = useToast();
const factsheet = useFactsheet(props.agvId);

const error = ref("");
const expandedSections = ref<Set<string>>(new Set(["order-basic"]));

// Order form state
const orderForm = ref<{
  headerId: number;
  manufacturer: string;
  serialNumber: string;
  timestamp: string;
  version: string;
  orderId: string;
  orderUpdateId: number;
  zoneSetId: string;
  nodes: Node[];
  edges: Edge[];
}>({
  headerId: 1,
  manufacturer: props.agvId.manufacturer,
  serialNumber: props.agvId.serialNumber,
  timestamp: new Date().toISOString(),
  version: "2.0.0",
  orderId: `order_${Date.now()}`,
  orderUpdateId: 1,
  zoneSetId: "",
  nodes: [],
  edges: [],
});

// New order or update of the robot's current order (VDA5050 2.1.0, 6.6.2)
type OrderMode = "new" | "update";
const mqttStore = useMqttStore();
const robotState = computed(
  () =>
    mqttStore.agvDataMap.get(
      `${props.agvId.manufacturer}/${props.agvId.serialNumber}`
    )?.stateInfo ?? null
);
const orderActive = computed(() => isOrderActive(robotState.value));
const canUpdate = computed(() => !!robotState.value?.orderId);
const mode = ref<OrderMode>(orderActive.value ? "update" : "new");
const stitching = ref<"decisionPoint" | "lastNode" | null>(null);
const contentsMissing = ref(false);
const lastNodeStart = computed(() =>
  robotState.value ? lastNodeAsStart(robotState.value) : null
);

const messageHeader = () => ({
  headerId: (props.existingOrder?.headerId ?? 0) + 1,
  manufacturer: props.agvId.manufacturer,
  serialNumber: props.agvId.serialNumber,
  timestamp: new Date().toISOString(),
  version: robotState.value?.version || props.existingOrder?.version || "2.0.0",
  zoneSetId: "",
});

const startNewOrder = () => {
  orderForm.value = {
    ...messageHeader(),
    orderId: `order_${Date.now()}`,
    orderUpdateId: 0,
    nodes: [],
    edges: [],
  };
  stitching.value = null;
  contentsMissing.value = false;
};

/** Starts an update with the stitching node and the robot's current horizon */
const startOrderUpdate = () => {
  const update = robotState.value
    ? buildOrderUpdate(robotState.value, props.existingOrder)
    : null;
  if (!update) {
    mode.value = "new";
    startNewOrder();
    return;
  }
  orderForm.value = {
    ...messageHeader(),
    orderId: update.orderId,
    orderUpdateId: update.orderUpdateId,
    nodes: update.nodes,
    edges: update.edges,
  };
  stitching.value = update.stitching;
  contentsMissing.value = update.contentsMissing;
};

/** Switches between a new order and an update and starts the form over */
const switchMode = (value: OrderMode) => {
  mode.value = value;
  if (value === "update") startOrderUpdate();
  else startNewOrder();
};
switchMode(mode.value);

// Saved orders (saved-orders.json in the package folder, via the dev server)
const savedOrders = ref<SavedOrder[]>([]);
const savedOrdersError = ref("");
const saveName = ref("");
const showSave = ref(false);
const saveExists = computed(() =>
  savedOrders.value.some((saved) => saved.name === saveName.value.trim())
);

const refreshSavedOrders = async () => {
  try {
    savedOrders.value = await fetchSavedOrders();
    savedOrdersError.value = "";
  } catch (err: any) {
    savedOrdersError.value = err.message;
  }
};
onMounted(refreshSavedOrders);

const openSave = () => {
  if (!saveName.value) saveName.value = orderForm.value.orderId;
  showSave.value = true;
};

const saveCurrentOrder = async () => {
  const name = saveName.value.trim();
  if (!name) return;
  try {
    savedOrders.value = await saveOrderFile(name, props.agvId, orderForm.value);
    savedOrdersError.value = "";
    showSave.value = false;
    toast({ title: "Order saved", description: `Saved as "${name}".` });
  } catch (err: any) {
    toast({
      title: "Saving failed",
      description: err.message,
      variant: "destructive",
    });
  }
};

/** Loads a saved order into the form as a new order */
const loadSavedOrder = (saved: SavedOrder) => {
  switchMode("new");
  const contents = savedOrderContents(saved);
  orderForm.value.nodes = contents.nodes;
  orderForm.value.edges = contents.edges;
  orderForm.value.zoneSetId = contents.zoneSetId;
  saveName.value = saved.name;
  draft.selectedIndex = null;
};

/** The stitching node of an update cannot be changed */
const isLocked = (nodeIndex: number) =>
  mode.value === "update" && nodeIndex === 0;

const startFromLastNode = () => {
  if (lastNodeStart.value) {
    insertStartNode(orderForm.value, structuredClone(lastNodeStart.value));
  }
};

// Share the draft with the graph for the preview and drawing on the map
const draft = useOrderDraftStore();
const draftForm = orderForm as unknown as Ref<OrderChain>;
onMounted(() => {
  draft.attach(draftForm, props.agvId);
  draft.lockedCount = mode.value === "update" ? 1 : 0;
});
watch(mode, (value) => {
  draft.lockedCount = value === "update" ? 1 : 0;
});
onBeforeUnmount(() => draft.detach(draftForm));

const pathIssues = computed(() => chainIssues(orderForm.value));

// Expanded node and edge cards; new cards and the node selected on the
// graph are expanded, the others show a one-line summary
const openItems = reactive(new Set<object>());
const isOpen = (item: object) => openItems.has(item);
const toggleOpen = (item: object) => {
  if (openItems.has(item)) openItems.delete(item);
  else openItems.add(item);
};
const setAllOpen = (items: object[], open: boolean) => {
  items.forEach((item) =>
    open ? openItems.add(item) : openItems.delete(item)
  );
};
const decisionPoint = computed(() => decisionPointIndex(orderForm.value));

const toggleDrawMode = () => {
  draft.drawMode = !draft.drawMode;
  if (draft.drawMode) expandedSections.value.add("order-nodes");
};

// Show the node selected on the graph
watch(
  () => draft.selectedIndex,
  async (index) => {
    if (index === null) return;
    expandedSections.value.add("order-nodes");
    // Show only the selected node expanded
    setAllOpen(orderForm.value.nodes, false);
    const node = orderForm.value.nodes[index];
    if (node) openItems.add(node);
    await nextTick();
    document
      .getElementById(`order-node-${index}`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
);

// Build Order from form data
const buildOrderFromForm = (): Order => {
  const order: Order = {
    headerId: orderForm.value.headerId,
    manufacturer: orderForm.value.manufacturer,
    serialNumber: orderForm.value.serialNumber,
    timestamp: orderForm.value.timestamp || new Date().toISOString(),
    version: orderForm.value.version,
    orderId: orderForm.value.orderId,
    orderUpdateId: orderForm.value.orderUpdateId,
    nodes: orderForm.value.nodes,
    edges: orderForm.value.edges,
  };

  if (orderForm.value.zoneSetId) {
    order.zoneSetId = orderForm.value.zoneSetId;
  }

  return order;
};

// Publish Order
const publishOrder = () => {
  try {
    // Validate required fields
    if (
      !orderForm.value.headerId ||
      !orderForm.value.manufacturer ||
      !orderForm.value.serialNumber ||
      !orderForm.value.version ||
      !orderForm.value.orderId ||
      orderForm.value.orderUpdateId === undefined
    ) {
      error.value =
        "Missing required fields: headerId, manufacturer, serialNumber, version, orderId, orderUpdateId";
      return;
    }

    const order = buildOrderFromForm();
    const key = `${props.agvId.manufacturer}/${props.agvId.serialNumber}`;
    const controller = agvControllers.value.get(key);

    if (!controller) {
      error.value = "AGV controller not found";
      return;
    }

    controller.publishOrder(order, unref(interfaceName));
    error.value = "";
    toast({
      title: "Order published",
      description: "Order published successfully!",
    });
    emit("published");
  } catch (err: any) {
    error.value = `Failed to publish: ${err.message}`;
  }
};

// Helper functions for managing arrays
/** mapId for a new node or position: the robot's map, else the previous node's */
const newNodeMapId = () =>
  defaultMapId(orderForm.value, robotState.value?.agvPosition?.mapId);

// Nodes and edges form a chain (edge i joins node i and i + 1), so adding or
// removing a node adds or removes its edge as well
const addNode = () => {
  draft.addNode({ mapId: newNodeMapId() });
};

const removeNode = (index: number) => {
  draft.removeNode(index);
};

const addEdge = () => {
  draft.addEdge();
  const edges = orderForm.value.edges;
  openItems.add(edges[edges.length - 1]);
  expandedSections.value.add("order-edges");
};

const removeEdge = (index: number) => {
  draft.removeEdge(index);
};

/** Node ids offered for the start and end of edges */
const nodeIds = computed(() => [
  ...new Set(orderForm.value.nodes.map((node) => node.nodeId)),
]);

const addActionToNode = (nodeIndex: number) => {
  if (!orderForm.value.nodes[nodeIndex].actions) {
    orderForm.value.nodes[nodeIndex].actions = [];
  }
  orderForm.value.nodes[nodeIndex].actions.push({
    actionId: `action_${orderForm.value.nodes[nodeIndex].actions.length + 1}`,
    actionType: "",
    blockingType: BlockingTypeEnum.None,
  });
};

const removeActionFromNode = (nodeIndex: number, actionIndex: number) => {
  orderForm.value.nodes[nodeIndex].actions.splice(actionIndex, 1);
};

const addActionToEdge = (edgeIndex: number) => {
  if (!orderForm.value.edges[edgeIndex].actions) {
    orderForm.value.edges[edgeIndex].actions = [];
  }
  orderForm.value.edges[edgeIndex].actions.push({
    actionId: `action_${orderForm.value.edges[edgeIndex].actions.length + 1}`,
    actionType: "",
    blockingType: BlockingTypeEnum.None,
  });
};

const removeActionFromEdge = (edgeIndex: number, actionIndex: number) => {
  orderForm.value.edges[edgeIndex].actions.splice(actionIndex, 1);
};

const toggleSection = (section: string) => {
  if (expandedSections.value.has(section)) {
    expandedSections.value.delete(section);
  } else {
    expandedSections.value.add(section);
  }
};

const generateRandomOrderAndPublish = () => {
  try {
    const key = `${props.agvId.manufacturer}/${props.agvId.serialNumber}`;
    const controller = agvControllers.value.get(key);

    if (!controller) {
      error.value = "AGV controller not found";
      return;
    }

    const agvPosition = controller.stateInfo?.value?.agvPosition;
    const initialPosition =
      agvPosition?.x != null && agvPosition?.y != null
        ? {
            x: agvPosition.x,
            y: agvPosition.y,
            mapId: agvPosition?.mapId ?? "map_1",
          }
        : { x: 0, y: 0, mapId: "map_1" };

    const endPoint = {
      x: Math.floor(Math.random() * 20 - 10),
      y: Math.round(Math.random() * 20 - 10),
    };
    const route = generateManhattanRoute(
      { x: initialPosition.x, y: initialPosition.y },
      endPoint
    );

    if (route.length < 3) {
      generateRandomOrderAndPublish();
      return;
    }

    const order: Order = {
      headerId: orderForm.value.headerId,
      manufacturer: orderForm.value.manufacturer,
      serialNumber: orderForm.value.serialNumber,
      timestamp: new Date().toISOString(),
      version: orderForm.value.version,
      orderId: `order_${Date.now()}`,
      orderUpdateId: orderForm.value.orderUpdateId + 1,
      nodes: route.map(({ x, y }, i) => ({
        nodeId: (i + 1).toString(),
        sequenceId: i * 2,
        released: true,
        actions: [],
        nodePosition: {
          x,
          y,
          mapId: initialPosition.mapId,
        },
      })),
      edges: route.slice(1).map((_, i) => ({
        edgeId: (i + 1).toString(),
        released: true,
        actions: [],
        startNodeId: (i + 1).toString(),
        endNodeId: (i + 2).toString(),
        sequenceId: i * 2 + 1,
      })),
    };

    controller.publishOrder(order, unref(interfaceName));
    error.value = "";
    toast({
      title: "Order published",
      description: "Random order published successfully!",
    });
    emit("published");
  } catch (err: any) {
    error.value = `Failed to publish random order: ${err.message}`;
  }
};
</script>

<template>
  <div class="space-y-4">
    <div
      class="flex items-center justify-between top-0 bg-background z-10 pb-2 border-b"
    >
      <div class="text-sm font-semibold flex items-center gap-2">
        <Icon icon="material-symbols:list-alt" class="w-4 h-4" />
        Create Order
      </div>
      <div class="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          class="h-7 text-xs"
          @click="generateRandomOrderAndPublish"
        >
          <Icon icon="material-symbols:shuffle" class="w-3.5 h-3.5 mr-1" />
          Generate Random
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="h-6 w-6 p-0"
          @click="emit('close')"
        >
          <Icon icon="material-symbols:close" class="w-4 h-4" />
        </Button>
      </div>
    </div>

    <div
      v-if="error"
      class="text-sm text-red-500 bg-red-50 dark:bg-red-950 p-2 rounded"
    >
      {{ error }}
    </div>

    <div class="space-y-4">
      <FactsheetStatus :factsheet="factsheet" />

      <!-- New order / order update -->
      <div class="border rounded-lg p-3 space-y-2 text-xs">
        <div class="flex gap-2">
          <Button
            size="sm"
            :variant="mode === 'new' ? 'default' : 'outline'"
            class="h-7 text-xs flex-1"
            @click="switchMode('new')"
          >
            New Order
          </Button>
          <Button
            size="sm"
            :variant="mode === 'update' ? 'default' : 'outline'"
            class="h-7 text-xs flex-1"
            :disabled="!canUpdate"
            :title="canUpdate ? '' : 'The robot reports no order to update'"
            @click="switchMode('update')"
          >
            Update Order
          </Button>
        </div>
        <p v-if="mode === 'update'" class="text-muted-foreground">
          Update {{ orderForm.orderUpdateId }} of order
          {{ orderForm.orderId }}
          ({{ orderActive ? "active" : "completed" }}). It starts at the
          {{
            stitching === "decisionPoint"
              ? "decision point"
              : "last traversed node"
          }}
          {{ orderForm.nodes[0]?.nodeId }} ({{
            orderForm.nodes[0]?.sequenceId
          }}); the robot keeps that node's contents. The current horizon can be
          released or changed.
        </p>
        <p v-if="mode === 'update' && contentsMissing" class="text-amber-600">
          No order message of this order was seen, so the horizon is loaded
          without its actions and edge settings; add them again before
          publishing.
        </p>
        <div v-else-if="lastNodeStart" class="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            class="h-7 text-xs"
            :title="`Add ${lastNodeStart.nodeId} at the robot's position as the first node`"
            @click="startFromLastNode"
          >
            <Icon icon="material-symbols:start" class="w-3 h-3 mr-1" />
            Start from Last Node ({{ lastNodeStart.nodeId }})
          </Button>
        </div>
      </div>

      <!-- Saved orders -->
      <div class="border rounded-lg p-3 space-y-2 text-xs">
        <div
          class="flex items-center justify-between cursor-pointer"
          @click="toggleSection('order-saved')"
        >
          <h3 class="font-semibold text-sm">
            Saved Orders ({{ savedOrders.length }})
          </h3>
          <Icon
            :icon="
              expandedSections.has('order-saved')
                ? 'material-symbols:expand-less'
                : 'material-symbols:expand-more'
            "
            class="w-4 h-4"
          />
        </div>
        <template v-if="expandedSections.has('order-saved')">
          <p v-if="savedOrdersError" class="text-amber-600">
            {{ savedOrdersError }}
          </p>
          <p v-else-if="savedOrders.length === 0" class="text-muted-foreground">
            No saved orders. Use Save next to Publish Order.
          </p>
          <div
            v-for="saved in savedOrders"
            :key="saved.name"
            class="flex items-center gap-2 border rounded px-2 py-1"
          >
            <div class="min-w-0 flex-1">
              <div class="font-medium truncate">{{ saved.name }}</div>
              <div class="text-[10px] text-muted-foreground truncate">
                {{ saved.order.nodes.length }} nodes ·
                {{ saved.serialNumber }} ·
                {{ new Date(saved.savedAt).toLocaleString() }}
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              class="h-6 text-xs shrink-0"
              :title="`Load ${saved.name} into the form as a new order`"
              @click="loadSavedOrder(saved)"
            >
              Load
            </Button>
          </div>
        </template>
      </div>

      <!-- Basic Information -->
      <div class="border rounded-lg p-4 space-y-3">
        <div
          class="flex items-center justify-between cursor-pointer"
          @click="toggleSection('order-basic')"
        >
          <h3 class="font-semibold text-sm">Basic Information</h3>
          <Icon
            :icon="
              expandedSections.has('order-basic')
                ? 'material-symbols:expand-less'
                : 'material-symbols:expand-more'
            "
            class="w-4 h-4"
          />
        </div>
        <div v-if="expandedSections.has('order-basic')" class="space-y-3 pt-2">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <Label class="text-xs">Header ID</Label>
              <Input
                v-model.number="orderForm.headerId"
                type="number"
                class="h-8 text-xs"
              />
            </div>
            <div>
              <Label class="text-xs">Order Update ID</Label>
              <Input
                v-model.number="orderForm.orderUpdateId"
                type="number"
                class="h-8 text-xs"
              />
            </div>
          </div>
          <div>
            <Label class="text-xs">Order ID</Label>
            <Input v-model="orderForm.orderId" class="h-8 text-xs" />
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <Label class="text-xs">Manufacturer</Label>
              <Input v-model="orderForm.manufacturer" class="h-8 text-xs" />
            </div>
            <div>
              <Label class="text-xs">Serial Number</Label>
              <Input v-model="orderForm.serialNumber" class="h-8 text-xs" />
            </div>
          </div>
          <div>
            <Label class="text-xs">Version</Label>
            <Input v-model="orderForm.version" class="h-8 text-xs" />
          </div>
          <div>
            <Label class="text-xs">Zone Set ID (Optional)</Label>
            <Input v-model="orderForm.zoneSetId" class="h-8 text-xs" />
          </div>
          <div>
            <Label class="text-xs">Timestamp</Label>
            <div class="flex gap-2">
              <Input
                :model-value="
                  orderForm.timestamp
                    ? new Date(orderForm.timestamp).toISOString().slice(0, 16)
                    : ''
                "
                @update:model-value="
                  (val) =>
                    (orderForm.timestamp = val
                      ? new Date(val).toISOString()
                      : new Date().toISOString())
                "
                type="datetime-local"
                class="h-8 text-xs flex-1"
              />
              <Button
                size="sm"
                variant="outline"
                class="h-8 text-xs"
                @click="orderForm.timestamp = new Date().toISOString()"
              >
                Now
              </Button>
            </div>
          </div>
        </div>
      </div>

      <!-- Nodes -->
      <div class="border rounded-lg p-4 space-y-3">
        <div class="flex items-center justify-between">
          <div
            class="flex items-center justify-between cursor-pointer flex-1"
            @click="toggleSection('order-nodes')"
          >
            <h3 class="font-semibold text-sm">
              Nodes ({{ orderForm.nodes.length }})
            </h3>
            <Icon
              :icon="
                expandedSections.has('order-nodes')
                  ? 'material-symbols:expand-less'
                  : 'material-symbols:expand-more'
              "
              class="w-4 h-4"
            />
          </div>
          <Button
            size="sm"
            variant="ghost"
            class="h-7 w-7 p-0 ml-2"
            title="Expand all"
            @click="setAllOpen(orderForm.nodes, true)"
          >
            <Icon icon="material-symbols:unfold-more" class="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            class="h-7 w-7 p-0"
            title="Collapse all"
            @click="setAllOpen(orderForm.nodes, false)"
          >
            <Icon icon="material-symbols:unfold-less" class="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            class="h-7 text-xs"
            @click="addNode"
          >
            <Icon icon="material-symbols:add" class="w-3 h-3 mr-1" />
            Add Node
          </Button>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            :variant="draft.drawMode ? 'default' : 'outline'"
            class="h-7 text-xs"
            @click="toggleDrawMode"
          >
            <Icon icon="material-symbols:draw-outline" class="w-3 h-3 mr-1" />
            {{ draft.drawMode ? "Drawing on Map" : "Draw on Map" }}
          </Button>
          <Button
            size="sm"
            variant="outline"
            class="h-7 text-xs"
            :disabled="orderForm.nodes.length <= draft.lockedCount"
            @click="draft.undoLastNode()"
          >
            <Icon icon="material-symbols:undo" class="w-3 h-3 mr-1" />
            Undo Node
          </Button>
          <Button
            size="sm"
            variant="outline"
            class="h-7 text-xs"
            title="Renumber sequence ids and connect consecutive nodes with edges"
            @click="draft.relink()"
          >
            <Icon icon="material-symbols:link" class="w-3 h-3 mr-1" />
            Link Nodes
          </Button>
        </div>
        <p v-if="draft.drawMode" class="text-xs text-muted-foreground">
          Click the map to add a node, click a robot, an order node or a drawn
          node to add it again. Drag nodes to move them and the handle to set
          theta.
        </p>
        <div
          v-if="pathIssues.length > 0"
          class="text-xs text-red-500 bg-red-50 dark:bg-red-950 p-2 rounded"
        >
          <div v-for="issue in pathIssues" :key="issue">{{ issue }}</div>
          <div class="text-muted-foreground">
            A VDA5050 order is a sequence (edge i joins node i and i + 1). Link
            Nodes turns the order into one, replacing manual edges.
          </div>
        </div>
        <div v-if="expandedSections.has('order-nodes')" class="space-y-3 pt-2">
          <div
            v-for="(node, nodeIndex) in orderForm.nodes"
            :id="'order-node-' + nodeIndex"
            :key="nodeIndex"
            class="border rounded p-3 space-y-2 bg-muted/30"
            :class="{
              'ring-2 ring-violet-600': draft.selectedIndex === nodeIndex,
            }"
          >
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="p-0.5 rounded hover:bg-muted"
                :title="isOpen(node) ? 'Collapse' : 'Expand'"
                @click="toggleOpen(node)"
              >
                <Icon
                  :icon="
                    isOpen(node)
                      ? 'material-symbols:expand-more'
                      : 'material-symbols:chevron-right'
                  "
                  class="w-4 h-4"
                />
              </button>
              <span
                class="text-xs font-medium cursor-pointer"
                title="Highlight on the map"
                @click="draft.selectedIndex = nodeIndex"
                >Node {{ nodeIndex + 1 }}</span
              >
              <span
                class="text-[10px] px-1.5 rounded"
                :class="
                  node.released
                    ? 'bg-orange-500 text-white'
                    : 'bg-orange-200 text-orange-900'
                "
              >
                {{
                  isLocked(nodeIndex)
                    ? "Stitching node"
                    : nodeIndex === decisionPoint &&
                      nodeIndex < orderForm.nodes.length - 1
                    ? "Decision point"
                    : node.released
                    ? "Base"
                    : "Horizon"
                }}
              </span>
              <span
                v-if="!isOpen(node)"
                class="text-[10px] text-muted-foreground truncate"
              >
                {{ node.nodeId }} · {{ node.sequenceId }}
                <template v-if="node.nodePosition">
                  · ({{ node.nodePosition.x }}, {{ node.nodePosition.y }})
                </template>
                · {{ node.actions?.length || 0 }} actions
              </span>
              <div class="flex-1" />
              <Button
                size="sm"
                variant="ghost"
                class="h-6 text-[10px] px-1.5"
                title="Release the nodes up to this one (base); the nodes after it become the horizon"
                @click="draft.releaseUpTo(nodeIndex)"
              >
                <Icon
                  icon="material-symbols:flag-outline"
                  class="w-3 h-3 mr-1"
                />
                Release up to here
              </Button>
              <Button
                size="sm"
                variant="ghost"
                class="h-6 w-6 p-0"
                title="Remove node"
                :disabled="isLocked(nodeIndex)"
                @click="removeNode(nodeIndex)"
              >
                <Icon icon="material-symbols:delete" class="w-3 h-3" />
              </Button>
            </div>
            <div v-if="isOpen(node)" class="space-y-2">
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <Label class="text-xs">Node ID</Label>
                  <Input
                    v-model="node.nodeId"
                    :disabled="isLocked(nodeIndex)"
                    class="h-7 text-xs"
                  />
                </div>
                <div>
                  <Label class="text-xs">Sequence ID</Label>
                  <Input
                    v-model.number="node.sequenceId"
                    :disabled="isLocked(nodeIndex)"
                    type="number"
                    class="h-7 text-xs"
                  />
                </div>
              </div>
              <div class="flex items-center gap-2">
                <input
                  type="checkbox"
                  v-model="node.released"
                  :disabled="isLocked(nodeIndex)"
                  :id="'node-released-' + nodeIndex"
                  class="w-4 h-4"
                />
                <Label
                  :for="'node-released-' + nodeIndex"
                  class="text-xs cursor-pointer"
                  >Released</Label
                >
              </div>
              <div v-if="!node.nodePosition" class="pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  class="h-6 text-xs"
                  @click="
                    node.nodePosition = { x: 0, y: 0, mapId: newNodeMapId() }
                  "
                >
                  <Icon
                    icon="material-symbols:add-location"
                    class="w-3 h-3 mr-1"
                  />
                  Add Position
                </Button>
              </div>
              <div v-else class="grid grid-cols-3 gap-2">
                <div>
                  <Label class="text-xs">X</Label>
                  <Input
                    v-model.number="node.nodePosition.x"
                    :disabled="isLocked(nodeIndex)"
                    type="number"
                    class="h-7 text-xs"
                  />
                </div>
                <div>
                  <Label class="text-xs">Y</Label>
                  <Input
                    v-model.number="node.nodePosition.y"
                    :disabled="isLocked(nodeIndex)"
                    type="number"
                    class="h-7 text-xs"
                  />
                </div>
                <div>
                  <Label class="text-xs">Theta (rad)</Label>
                  <Input
                    :model-value="node.nodePosition.theta ?? ''"
                    :disabled="isLocked(nodeIndex)"
                    type="number"
                    step="0.01"
                    placeholder="not set"
                    class="h-7 text-xs"
                    @update:model-value="
                      (val) => {
                        if (!node.nodePosition) return;
                        if (val === '' || val === undefined) {
                          delete node.nodePosition.theta;
                        } else {
                          node.nodePosition.theta = Number(val);
                        }
                      }
                    "
                  />
                </div>
                <div class="space-y-1 col-span-3">
                  <Label class="text-xs">Map ID</Label>
                  <div class="flex gap-1">
                    <Input
                      v-model="node.nodePosition.mapId"
                      :disabled="isLocked(nodeIndex)"
                      class="h-7 text-xs flex-1"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      class="h-7 w-7 p-0"
                      :disabled="isLocked(nodeIndex)"
                      @click="node.nodePosition = undefined"
                    >
                      <Icon icon="material-symbols:close" class="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </div>
              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <Label class="text-xs"
                    >Actions ({{ node.actions?.length || 0 }})</Label
                  >
                  <Button
                    size="sm"
                    variant="ghost"
                    class="h-6 text-xs"
                    :disabled="isLocked(nodeIndex)"
                    @click="addActionToNode(nodeIndex)"
                  >
                    <Icon icon="material-symbols:add" class="w-3 h-3 mr-1" />
                    Add Action
                  </Button>
                </div>
                <div
                  v-for="(action, actionIndex) in node.actions"
                  :key="actionIndex"
                  class="pl-2 border-l-2 space-y-2 bg-background/50 p-2 rounded"
                >
                  <ActionEditor
                    v-model:action="node.actions[actionIndex]"
                    scope="NODE"
                    :catalog="factsheet.catalog.value"
                    @remove="removeActionFromNode(nodeIndex, actionIndex)"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Edges -->
      <div class="border rounded-lg p-4 space-y-3">
        <div class="flex items-center justify-between">
          <div
            class="flex items-center justify-between cursor-pointer flex-1"
            @click="toggleSection('order-edges')"
          >
            <h3 class="font-semibold text-sm">
              Edges ({{ orderForm.edges.length }})
            </h3>
            <Icon
              :icon="
                expandedSections.has('order-edges')
                  ? 'material-symbols:expand-less'
                  : 'material-symbols:expand-more'
              "
              class="w-4 h-4"
            />
          </div>
          <Button
            size="sm"
            variant="ghost"
            class="h-7 w-7 p-0 ml-2"
            title="Expand all"
            @click="setAllOpen(orderForm.edges, true)"
          >
            <Icon icon="material-symbols:unfold-more" class="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            class="h-7 w-7 p-0"
            title="Collapse all"
            @click="setAllOpen(orderForm.edges, false)"
          >
            <Icon icon="material-symbols:unfold-less" class="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            class="h-7 text-xs"
            title="Add an edge by hand, e.g. for a branch"
            @click="addEdge"
          >
            <Icon icon="material-symbols:add" class="w-3 h-3 mr-1" />
            Add Edge
          </Button>
        </div>
        <div v-if="expandedSections.has('order-edges')" class="space-y-3 pt-2">
          <datalist id="order-node-ids">
            <option v-for="nodeId in nodeIds" :key="nodeId" :value="nodeId" />
          </datalist>
          <p class="text-xs text-muted-foreground">
            Adding or removing a node adds or removes the edge to it. Add Edge
            adds further edges by hand, e.g. branches; a VDA5050 order is a
            single sequence, so only edges that join consecutive nodes are valid
            (problems are listed in the Nodes section).
          </p>
          <div
            v-for="(edge, edgeIndex) in orderForm.edges"
            :key="edgeIndex"
            class="border rounded p-3 space-y-2 bg-muted/30"
          >
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="p-0.5 rounded hover:bg-muted"
                :title="isOpen(edge) ? 'Collapse' : 'Expand'"
                @click="toggleOpen(edge)"
              >
                <Icon
                  :icon="
                    isOpen(edge)
                      ? 'material-symbols:expand-more'
                      : 'material-symbols:chevron-right'
                  "
                  class="w-4 h-4"
                />
              </button>
              <span class="text-xs font-medium">Edge {{ edgeIndex + 1 }}</span>
              <span
                v-if="!isOpen(edge)"
                class="text-[10px] text-muted-foreground truncate"
              >
                {{ edge.edgeId }} · {{ edge.startNodeId }} →
                {{ edge.endNodeId }} · {{ edge.actions?.length || 0 }} actions
              </span>
              <div class="flex-1" />
              <Button
                size="sm"
                variant="ghost"
                class="h-6 w-6 p-0"
                title="Remove edge"
                @click="removeEdge(edgeIndex)"
              >
                <Icon icon="material-symbols:delete" class="w-3 h-3" />
              </Button>
            </div>
            <div v-if="isOpen(edge)" class="space-y-2">
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <Label class="text-xs">Edge ID</Label>
                  <Input v-model="edge.edgeId" class="h-7 text-xs" />
                </div>
                <div>
                  <Label class="text-xs">Sequence ID</Label>
                  <Input
                    v-model.number="edge.sequenceId"
                    type="number"
                    class="h-7 text-xs"
                  />
                </div>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <Label class="text-xs">Start Node ID</Label>
                  <Input
                    v-model="edge.startNodeId"
                    list="order-node-ids"
                    class="h-7 text-xs"
                  />
                </div>
                <div>
                  <Label class="text-xs">End Node ID</Label>
                  <Input
                    v-model="edge.endNodeId"
                    list="order-node-ids"
                    class="h-7 text-xs"
                  />
                </div>
              </div>
              <div class="flex items-center gap-2">
                <input
                  type="checkbox"
                  v-model="edge.released"
                  :id="'edge-released-' + edgeIndex"
                  class="w-4 h-4"
                />
                <Label
                  :for="'edge-released-' + edgeIndex"
                  class="text-xs cursor-pointer"
                  >Released</Label
                >
              </div>
              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <Label class="text-xs"
                    >Actions ({{ edge.actions?.length || 0 }})</Label
                  >
                  <Button
                    size="sm"
                    variant="ghost"
                    class="h-6 text-xs"
                    @click="addActionToEdge(edgeIndex)"
                  >
                    <Icon icon="material-symbols:add" class="w-3 h-3 mr-1" />
                    Add Action
                  </Button>
                </div>
                <div
                  v-for="(action, actionIndex) in edge.actions"
                  :key="actionIndex"
                  class="pl-2 border-l-2 space-y-2 bg-background/50 p-2 rounded"
                >
                  <ActionEditor
                    v-model:action="edge.actions[actionIndex]"
                    scope="EDGE"
                    :catalog="factsheet.catalog.value"
                    @remove="removeActionFromEdge(edgeIndex, actionIndex)"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Actions -->
      <div v-if="showSave" class="flex gap-2 pt-2 border-t">
        <Input
          v-model="saveName"
          placeholder="Name of the saved order"
          class="h-8 text-xs flex-1"
          @keyup.enter="saveCurrentOrder"
        />
        <Button
          size="sm"
          class="h-8 text-xs"
          title="Save the order under this name"
          :disabled="!saveName.trim()"
          @click="saveCurrentOrder"
        >
          {{ saveExists ? "Overwrite" : "Save" }}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          class="h-8 w-8 p-0"
          title="Cancel saving"
          @click="showSave = false"
        >
          <Icon icon="material-symbols:close" class="w-4 h-4" />
        </Button>
      </div>
      <div class="flex gap-2 pt-2 border-t">
        <Button @click="publishOrder" class="flex-1">
          <Icon icon="material-symbols:send" class="w-4 h-4 mr-2" />
          Publish Order
        </Button>
        <Button variant="outline" @click="openSave">
          <Icon icon="material-symbols:save-outline" class="w-4 h-4 mr-2" />
          Save
        </Button>
        <Button variant="outline" @click="emit('close')"> Cancel </Button>
      </div>
    </div>
  </div>
</template>
