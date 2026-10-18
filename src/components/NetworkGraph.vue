<script setup lang="ts">
import { computed, ref } from "vue";
import type { EventHandlers, Instance } from "v-network-graph";
import { useVDA5050 } from "@/composables/useVDA5050";
import { useColorMode } from "@vueuse/core";
import { createConfigs } from "@/utils/configs";
import { useSettingsStore } from "@/stores/settings";
import { useMapsStore } from "@/stores/maps";
import { computeMapPlacement } from "@/utils/ros-map";
import {
  draftIndexOf,
  DRAFT_COLOR,
  DRAFT_SELECTED_COLOR,
  useOrderDraftGraph,
} from "@/composables/useOrderDraftGraph";
import { headingTo } from "@/utils/order-draft";
import {
  headingArrowPoints,
  headingLineEnd,
  robotHeadings,
} from "@/utils/robot-heading";

const { totalNodes, totalEdges, totalLayouts } = useVDA5050();
const settingsStore = useSettingsStore();
const mapsStore = useMapsStore();
const draftGraph = useOrderDraftGraph();
const draft = draftGraph.draft;

const graph = ref<Instance>();
const container = ref<HTMLElement>();

// Map images are drawn below the edges and nodes, heading handles on top so
// node labels cannot cover them
const layers = {
  map: "base",
  robotHeadings: "nodes",
  headings: "node-labels",
};

const mapImages = computed(() =>
  mapsStore.displayedMaps.map((map) => ({
    id: map.id,
    image: map.image,
    ...computeMapPlacement(map.metadata, map.pixelWidth, map.pixelHeight),
  }))
);
const mode = useColorMode({
  selector: "html",
  attribute: "class",
  modes: {
    dark: "dark",
    light: "",
  },
});

// Create reactive configs based on dark mode and grid settings
const config = computed(() => {
  const configs = createConfigs(mode.value === "dark", settingsStore.showGrid);
  // Only the nodes of the order draft can be moved, except a locked
  // stitching node
  configs.node.draggable = (node) => node.draft === true && !node.locked;
  return configs;
});

// Robot orientation (agvPosition.theta), drawn on top of the robot nodes
const robots = computed(() =>
  robotHeadings(
    totalNodes.value as Record<string, any>,
    totalLayouts.value.nodes as Record<string, { x: number; y: number }>
  )
);
const isDark = computed(() => mode.value === "dark");

// Graph data: received orders and robots plus the order draft
const graphNodes = computed(() => ({
  ...totalNodes.value,
  ...draftGraph.nodes.value,
}));
const graphEdges = computed(() => ({
  ...totalEdges.value,
  ...draftGraph.edges.value,
}));
const graphLayouts = computed(() => ({
  nodes: { ...totalLayouts.value.nodes, ...draftGraph.layouts.value },
}));

/** Map position (metres, y up) of a pointer event */
function mapPosition(event: MouseEvent) {
  const rect = container.value?.getBoundingClientRect();
  if (!graph.value || !rect) return null;
  const point = graph.value.translateFromDomToSvgCoordinates({
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  });
  return { x: point.x, y: -point.y };
}

// A click that ends a node drag or a heading drag must not add a node
let suppressClickUntil = 0;
function suppressClicks() {
  suppressClickUntil = Date.now() + 300;
}

// Clickable radius of nodes that are not part of the draft, in screen pixels
const NODE_HIT_RADIUS_PX = 15;

/**
 * Graph key of the received-order, robot or locked draft node under a click.
 * These nodes are not interactive in v-network-graph, so their clicks arrive
 * as view:click.
 */
function nodeAt(event: MouseEvent): string | null {
  const rect = container.value?.getBoundingClientRect();
  if (!graph.value || !rect) return null;
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const point = graph.value.translateFromDomToSvgCoordinates({ x, y });
  const edge = graph.value.translateFromDomToSvgCoordinates({
    x: x + NODE_HIT_RADIUS_PX,
    y,
  });
  const radius = Math.abs(edge.x - point.x);

  let nearest: string | null = null;
  let nearestDistance = radius;
  // Draft nodes are included for the locked stitching node, which is not
  // interactive either
  const positions = graphLayouts.value.nodes as Record<
    string,
    { x: number; y: number }
  >;
  Object.entries(positions).forEach(([key, position]) => {
    const distance = Math.hypot(position.x - point.x, position.y - point.y);
    if (distance <= nearestDistance) {
      nearest = key;
      nearestDistance = distance;
    }
  });
  return nearest;
}

const eventHandlers: EventHandlers = {
  "view:click": ({ event }) => {
    if (!draft.drawMode || !draft.chain || Date.now() < suppressClickUntil) {
      return;
    }
    // A robot or a node of a received order is added again with its id
    const key = nodeAt(event);
    const reused = key ? draftGraph.nodeFromGraphKey(key) : null;
    if (reused) {
      draft.addNode(reused);
      return;
    }
    const position = mapPosition(event);
    if (!position) return;
    const round = (value: number) => Math.round(value * 1000) / 1000;
    draft.addNode({
      x: round(position.x),
      y: round(position.y),
      mapId: draftGraph.defaultMapId(),
    });
  },
  // Only draft nodes are interactive (draggable), so this is a draft node
  "node:click": ({ node }) => {
    if (Date.now() < suppressClickUntil) return;
    if (draft.drawMode && draft.chain) {
      const reused = draftGraph.nodeFromGraphKey(node);
      if (reused) draft.addNode(reused);
      return;
    }
    const index = draftIndexOf(node);
    if (index !== null) draft.selectedIndex = index;
  },
  "node:dragstart": () => suppressClicks(),
  "node:dragend": (positions) => {
    suppressClicks();
    Object.entries(positions).forEach(([key, position]) => {
      const index = draftIndexOf(key);
      if (index !== null) draft.moveNode(index, position.x, -position.y);
    });
  },
};

// Heading handles: drag the handle around the node to set nodePosition.theta
const HEADING_LENGTH_PX = 40;
const dragging = ref<number | null>(null);

function headingTip(
  heading: { x: number; y: number; theta?: number },
  scale: number
) {
  const theta = heading.theta ?? 0;
  // scale converts screen pixels to graph units (1 / zoom)
  const length = HEADING_LENGTH_PX * scale;
  return {
    x: heading.x + Math.cos(theta) * length,
    y: heading.y - Math.sin(theta) * length,
  };
}

function startHeadingDrag(index: number, event: PointerEvent) {
  dragging.value = index;
  (event.target as Element).setPointerCapture(event.pointerId);
}

function moveHeading(index: number, event: PointerEvent) {
  if (dragging.value !== index) return;
  const node = draft.chain?.nodes[index];
  const pointer = mapPosition(event);
  if (!node?.nodePosition || !pointer) return;
  // Hold Shift to snap to 15 degree steps
  draft.setTheta(
    index,
    headingTo(node.nodePosition, pointer, event.shiftKey ? 15 : 0)
  );
}

function endHeadingDrag(event: PointerEvent) {
  if (dragging.value === null) return;
  (event.target as Element).releasePointerCapture(event.pointerId);
  dragging.value = null;
  suppressClicks();
}
</script>

<template>
  <div
    ref="container"
    class="w-full h-full bg-background"
    :class="{ 'draw-mode': draft.drawMode }"
  >
    <v-network-graph
      ref="graph"
      class="w-full h-full"
      :nodes="graphNodes"
      :edges="graphEdges"
      :layouts="graphLayouts"
      :configs="config"
      :zoom-level="100"
      :layers="layers"
      :event-handlers="eventHandlers"
    >
      <template #map>
        <image
          v-for="map in mapImages"
          :key="map.id"
          :href="map.image"
          :x="map.x"
          :y="map.y"
          :width="map.width"
          :height="map.height"
          :transform="map.transform || undefined"
          :opacity="mapsStore.opacity"
          preserveAspectRatio="none"
          style="image-rendering: pixelated; pointer-events: none"
        />
      </template>
      <template #robotHeadings="{ scale }">
        <g
          v-for="robot in robots"
          :key="robot.key"
          style="pointer-events: none"
        >
          <line
            :x1="robot.x"
            :y1="robot.y"
            :x2="headingLineEnd(robot, scale).x"
            :y2="headingLineEnd(robot, scale).y"
            :stroke="isDark ? '#000' : '#fff'"
            :stroke-width="2.5 * scale"
            stroke-linecap="round"
          />
          <polygon
            :points="headingArrowPoints(robot, scale)"
            :fill="isDark ? '#fff' : '#000'"
          >
            <title>theta {{ robot.theta.toFixed(2) }} rad</title>
          </polygon>
        </g>
      </template>
      <template #headings="{ scale }">
        <g
          v-for="heading in draftGraph.headings.value"
          :key="heading.index"
          :opacity="heading.theta === undefined ? 0.4 : 1"
        >
          <line
            :x1="heading.x"
            :y1="heading.y"
            :x2="headingTip(heading, scale).x"
            :y2="headingTip(heading, scale).y"
            :stroke="
              draft.selectedIndex === heading.index
                ? DRAFT_SELECTED_COLOR
                : DRAFT_COLOR
            "
            :stroke-width="3 * scale"
            :stroke-dasharray="
              heading.theta === undefined ? `${4 * scale} ${3 * scale}` : ''
            "
            style="pointer-events: none"
          />
          <circle
            class="heading-handle"
            :cx="headingTip(heading, scale).x"
            :cy="headingTip(heading, scale).y"
            :r="7 * scale"
            :fill="
              draft.selectedIndex === heading.index
                ? DRAFT_SELECTED_COLOR
                : DRAFT_COLOR
            "
            stroke="#fff"
            :stroke-width="1.5 * scale"
            @pointerdown.stop.prevent="startHeadingDrag(heading.index, $event)"
            @pointermove="moveHeading(heading.index, $event)"
            @pointerup="endHeadingDrag"
            @pointercancel="endHeadingDrag"
            @mousedown.stop
            @touchstart.stop
            @click.stop
          >
            <title>
              Drag to set theta
              {{ heading.theta === undefined ? "(not set)" : heading.theta }}
              rad, Shift snaps to 15°
            </title>
          </circle>
        </g>
      </template>
    </v-network-graph>
  </div>
</template>

<style scoped>
/* Ensure v-network-graph takes full height */
:deep(.v-network-graph) {
  width: 100%;
  height: 100%;
}

.draw-mode :deep(.v-ng-canvas) {
  cursor: crosshair;
}

.heading-handle {
  cursor: grab;
  pointer-events: all;
}
</style>
