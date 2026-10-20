<script setup lang="ts">
import { computed } from "vue";
import { useVDA5050 } from "@/composables/useVDA5050";
import { useColorMode } from "@vueuse/core";
import { createConfigs } from "@/utils/configs";
import { useSettingsStore } from "@/stores/settings";
import {
  headingArrowPoints,
  headingLineEnd,
  robotHeadings,
} from "@/utils/robot-heading";

const { totalNodes, totalEdges, totalLayouts } = useVDA5050();
const settingsStore = useSettingsStore();

// Robot heading arrows are drawn above the nodes
const layers = { robotHeadings: "nodes" };
const mode = useColorMode({
  selector: "html",
  attribute: "class",
  modes: {
    dark: "dark",
    light: "",
  },
});

// Create reactive configs based on dark mode and grid settings
const config = computed(() =>
  createConfigs(mode.value === "dark", settingsStore.showGrid)
);

// Robot orientation (agvPosition.theta), drawn on top of the robot nodes
const robots = computed(() =>
  robotHeadings(
    totalNodes.value as Record<string, any>,
    totalLayouts.value.nodes as Record<string, { x: number; y: number }>
  )
);
const isDark = computed(() => mode.value === "dark");
</script>

<template>
  <div class="w-full h-full bg-background">
    <v-network-graph
      class="w-full h-full"
      :nodes="totalNodes"
      :edges="totalEdges"
      :layouts="totalLayouts"
      :configs="config"
      :zoom-level="100"
      :layers="layers"
    >
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
    </v-network-graph>
  </div>
</template>

<style scoped>
/* Ensure v-network-graph takes full height */
:deep(.v-network-graph) {
  width: 100%;
  height: 100%;
}
</style>
