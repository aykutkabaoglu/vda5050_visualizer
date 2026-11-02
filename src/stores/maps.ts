import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { v4 as uuidv4 } from "uuid";
import { useMqttStore } from "@/stores/mqtt";
import type { RosMapMetadata } from "@/utils/ros-map";

/** A map image with its ROS metadata, shown behind the graph */
export interface LoadedMap {
  id: string;
  /** VDA5050 mapId this image belongs to; empty for the default map */
  mapId: string;
  name: string;
  /** Image as a data URL */
  image: string;
  pixelWidth: number;
  pixelHeight: number;
  metadata: RosMapMetadata;
}

/** "auto" follows the robots' agvPosition.mapId, otherwise a LoadedMap id */
export type MapDisplayMode = "auto" | string;

const STORAGE_KEY = "vda5050Maps";

interface StoredMaps {
  maps: LoadedMap[];
  showMaps: boolean;
  opacity: number;
  displayMode: MapDisplayMode;
}

function loadStoredMaps(): Partial<StoredMaps> {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? (JSON.parse(saved) as Partial<StoredMaps>) : {};
  } catch (error) {
    console.warn("Could not load saved maps:", error);
    return {};
  }
}

export const useMapsStore = defineStore("maps", () => {
  const stored = loadStoredMaps();

  const maps = ref<LoadedMap[]>(stored.maps ?? []);
  const showMaps = ref<boolean>(stored.showMaps ?? true);
  const opacity = ref<number>(stored.opacity ?? 0.6);
  const displayMode = ref<MapDisplayMode>(stored.displayMode ?? "auto");
  /** False when the maps did not fit into localStorage and are lost on reload */
  const persisted = ref<boolean>(true);

  watch(
    [maps, showMaps, opacity, displayMode],
    () => {
      const data: StoredMaps = {
        maps: maps.value,
        showMaps: showMaps.value,
        opacity: opacity.value,
        displayMode: displayMode.value,
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        persisted.value = true;
      } catch (error) {
        console.warn(
          "Could not save maps (too large for localStorage):",
          error
        );
        persisted.value = false;
      }
    },
    { deep: true }
  );

  /** mapIds currently reported by the robots in state or visualization */
  const robotMapIds = computed(() => {
    const mqttStore = useMqttStore();
    const ids = new Set<string>();
    mqttStore.agvList.forEach((agv) => {
      const mapId =
        agv.stateInfo?.agvPosition?.mapId ??
        agv.visualizationInfo?.agvPosition?.mapId;
      if (typeof mapId === "string") {
        ids.add(mapId);
      }
    });
    return ids;
  });

  /**
   * Maps drawn behind the graph. In auto mode these are the maps whose mapId
   * a robot reports; if none match, the maps without a mapId, else the first map.
   */
  const displayedMaps = computed<LoadedMap[]>(() => {
    if (!showMaps.value || maps.value.length === 0) return [];

    if (displayMode.value !== "auto") {
      return maps.value.filter((map) => map.id === displayMode.value);
    }

    const matched = maps.value.filter(
      (map) => map.mapId !== "" && robotMapIds.value.has(map.mapId)
    );
    if (matched.length > 0) return matched;

    const defaults = maps.value.filter((map) => map.mapId === "");
    return defaults.length > 0 ? defaults : [maps.value[0]];
  });

  function addMap(map: Omit<LoadedMap, "id">): LoadedMap {
    const loaded: LoadedMap = { ...map, id: uuidv4() };
    maps.value.push(loaded);
    return loaded;
  }

  function removeMap(id: string) {
    maps.value = maps.value.filter((map) => map.id !== id);
    if (displayMode.value === id) {
      displayMode.value = "auto";
    }
  }

  return {
    maps,
    showMaps,
    opacity,
    displayMode,
    persisted,
    robotMapIds,
    displayedMaps,
    addMap,
    removeMap,
  };
});
