<script setup lang="ts">
import { computed, ref, unref, watch } from "vue";
import { Button } from "@/components/ui/button";
import { Icon } from "@iconify/vue";
import { useToast } from "@/components/ui/toast";
import { useMqttStore } from "@/stores/mqtt";
import {
  buildOrderUpdate,
  horizonNodes,
  isOrderActive,
  releaseHorizonUpTo,
  toOrderMessage,
} from "@/utils/order-update";

const props = defineProps<{
  agvId: { manufacturer: string; serialNumber: string };
  interfaceName?: string;
}>();

const mqttStore = useMqttStore();
const { toast } = useToast();
const key = computed(
  () => `${props.agvId.manufacturer}/${props.agvId.serialNumber}`
);
const agvData = computed(() => mqttStore.agvDataMap.get(key.value));
const state = computed(() => agvData.value?.stateInfo ?? null);
const lastOrder = computed(() => agvData.value?.orderInfo ?? null);

const horizon = computed(() =>
  isOrderActive(state.value) ? horizonNodes(state.value) : []
);
const contentsMissing = computed(() =>
  state.value
    ? buildOrderUpdate(state.value, lastOrder.value)?.contentsMissing ?? false
    : false
);

/** sequenceId of the last node to release */
const selected = ref<number | null>(null);
watch(horizon, (nodes) => {
  if (!nodes.some((node) => node.sequenceId === selected.value)) {
    selected.value = null;
  }
});
const selectedCount = computed(
  () =>
    horizon.value.filter((node) => node.sequenceId <= (selected.value ?? -1))
      .length
);

const release = () => {
  if (!state.value || selected.value === null) return;
  const update = releaseHorizonUpTo(
    state.value,
    lastOrder.value,
    selected.value
  );
  const controller = mqttStore.agvControllers.get(key.value);
  if (!update || !controller) {
    toast({
      title: "Release failed",
      description: "The order could not be built from the robot state.",
      variant: "destructive",
    });
    return;
  }
  const order = toOrderMessage(update, {
    headerId: (lastOrder.value?.headerId ?? 0) + 1,
    version: state.value.version || "2.0.0",
    manufacturer: props.agvId.manufacturer,
    serialNumber: props.agvId.serialNumber,
  });
  try {
    controller.publishOrder(order, unref(props.interfaceName) || undefined);
    toast({
      title: "Horizon released",
      description: `Update ${order.orderUpdateId} releases ${
        selectedCount.value
      } node(s) up to ${
        update.nodes.find((n) => n.sequenceId === selected.value)?.nodeId
      }.`,
    });
    selected.value = null;
  } catch (err: any) {
    toast({
      title: "Release failed",
      description: err.message,
      variant: "destructive",
    });
  }
};
</script>

<template>
  <div v-if="horizon.length > 0" class="border rounded-lg p-3 space-y-2">
    <div class="text-sm font-semibold flex items-center gap-2">
      <Icon icon="material-symbols:flag-outline" class="w-4 h-4" />
      Release Horizon
    </div>
    <p class="text-xs text-muted-foreground">
      Select the last node to release; it and all horizon nodes before it become
      part of the base (order update of {{ state?.orderId }}).
    </p>
    <div class="flex flex-wrap gap-1">
      <Button
        v-for="node in horizon"
        :key="node.sequenceId"
        size="sm"
        :variant="
          selected !== null && node.sequenceId <= selected
            ? 'default'
            : 'outline'
        "
        class="h-7 text-xs"
        @click="selected = node.sequenceId"
      >
        {{ node.nodeId }} ({{ node.sequenceId }})
      </Button>
    </div>
    <p v-if="contentsMissing" class="text-xs text-amber-600">
      No order message of this order was seen, so the released and remaining
      horizon nodes are sent without their actions and edge settings.
    </p>
    <Button
      size="sm"
      class="h-7 text-xs w-full"
      :disabled="selected === null"
      @click="release"
    >
      <Icon icon="material-symbols:send" class="w-3 h-3 mr-1" />
      {{
        selected === null ? "Select a node" : `Release ${selectedCount} node(s)`
      }}
    </Button>
  </div>
</template>
