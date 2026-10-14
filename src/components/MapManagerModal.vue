<script setup lang="ts">
import { computed, ref } from "vue";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Icon } from "@iconify/vue";
import { useMapsStore } from "@/stores/maps";
import { parseRosMapYaml, type RosMapMetadata } from "@/utils/ros-map";

defineProps<{
  open: boolean;
}>();

const emits = defineEmits<{
  "update:open": [value: boolean];
}>();

const mapsStore = useMapsStore();

// Form state for a new map
const imageFile = ref<{
  name: string;
  dataUrl: string;
  width: number;
  height: number;
} | null>(null);
const metadata = ref<RosMapMetadata | null>(null);
const mapId = ref("");
const error = ref("");
const imageInput = ref<HTMLInputElement | null>(null);
const yamlInput = ref<HTMLInputElement | null>(null);

const canAdd = computed(
  () => imageFile.value !== null && metadata.value !== null
);

const robotMapIdsText = computed(() => {
  const ids = Array.from(mapsStore.robotMapIds);
  if (ids.length === 0) return "no robot position received";
  return ids.map((id) => (id === "" ? "(empty)" : id)).join(", ");
});

const opacityValue = computed({
  get: () => [Math.round(mapsStore.opacity * 100)],
  set: (value: number[]) => {
    mapsStore.opacity = value[0] / 100;
  },
});

function readFile(file: File, asDataUrl: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    if (asDataUrl) {
      reader.readAsDataURL(file);
    } else {
      reader.readAsText(file);
    }
  });
}

function imageSize(
  dataUrl: string
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () =>
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () =>
      reject(new Error("The browser cannot display this image"));
    image.src = dataUrl;
  });
}

async function onImageSelected(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  imageFile.value = null;
  error.value = "";
  if (!file) return;
  try {
    const dataUrl = await readFile(file, true);
    const size = await imageSize(dataUrl);
    imageFile.value = { name: file.name, dataUrl, ...size };
  } catch (e) {
    error.value = `Image: ${(e as Error).message}`;
  }
}

async function onYamlSelected(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  metadata.value = null;
  error.value = "";
  if (!file) return;
  try {
    metadata.value = parseRosMapYaml(await readFile(file, false));
  } catch (e) {
    error.value = `YAML: ${(e as Error).message}`;
  }
}

function resetForm() {
  imageFile.value = null;
  metadata.value = null;
  mapId.value = "";
  error.value = "";
  if (imageInput.value) imageInput.value.value = "";
  if (yamlInput.value) yamlInput.value.value = "";
}

function addMap() {
  if (!imageFile.value || !metadata.value) return;
  mapsStore.addMap({
    mapId: mapId.value.trim(),
    name: imageFile.value.name,
    image: imageFile.value.dataUrl,
    pixelWidth: imageFile.value.width,
    pixelHeight: imageFile.value.height,
    metadata: metadata.value,
  });
  mapsStore.showMaps = true;
  resetForm();
}
</script>

<template>
  <Dialog :open="open" @update:open="emits('update:open', $event)">
    <DialogContent class="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Maps</DialogTitle>
        <DialogDescription>
          Load a ROS map image (PNG) with its YAML file to draw it behind the
          graph. Positions use the map frame, like agvPosition.
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4">
        <!-- Add map -->
        <div class="space-y-3 rounded-md border p-3">
          <div class="space-y-1">
            <Label for="mapImage">Map image (PNG)</Label>
            <input
              id="mapImage"
              ref="imageInput"
              type="file"
              accept="image/png,image/jpeg"
              class="block w-full text-sm"
              @change="onImageSelected"
            />
          </div>
          <div class="space-y-1">
            <Label for="mapYaml">Map YAML (resolution, origin)</Label>
            <input
              id="mapYaml"
              ref="yamlInput"
              type="file"
              accept=".yaml,.yml"
              class="block w-full text-sm"
              @change="onYamlSelected"
            />
          </div>
          <div class="space-y-1">
            <Label for="mapId">mapId (optional)</Label>
            <Input
              id="mapId"
              v-model="mapId"
              placeholder="Empty: default map when no mapId matches"
            />
          </div>
          <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
          <p
            v-if="
              metadata &&
              imageFile &&
              metadata.image &&
              metadata.image !== imageFile.name
            "
            class="text-xs text-muted-foreground"
          >
            The YAML refers to "{{ metadata.image }}", the selected image is "{{
              imageFile.name
            }}".
          </p>
          <Button :disabled="!canAdd" @click="addMap">
            <Icon icon="ph:plus" class="mr-2 h-4 w-4" />
            Add Map
          </Button>
        </div>

        <!-- Loaded maps -->
        <div class="space-y-2">
          <Label>Loaded maps</Label>
          <p
            v-if="mapsStore.maps.length === 0"
            class="text-sm text-muted-foreground"
          >
            No map loaded.
          </p>
          <div
            v-for="map in mapsStore.maps"
            :key="map.id"
            class="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
          >
            <div class="min-w-0">
              <div class="font-medium truncate">{{ map.name }}</div>
              <div class="text-xs text-muted-foreground">
                mapId: {{ map.mapId || "(default)" }} ·
                {{ (map.pixelWidth * map.metadata.resolution).toFixed(1) }} ×
                {{ (map.pixelHeight * map.metadata.resolution).toFixed(1) }} m ·
                origin ({{
                  map.metadata.origin.map((v) => v.toFixed(2)).join(", ")
                }})
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              class="h-8 w-8 shrink-0"
              title="Remove map"
              @click="mapsStore.removeMap(map.id)"
            >
              <Icon icon="ph:trash" class="h-4 w-4" />
            </Button>
          </div>
          <p v-if="!mapsStore.persisted" class="text-xs text-destructive">
            The maps are too large to save in the browser and will be lost on
            reload.
          </p>
        </div>

        <!-- Display settings -->
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <Label for="showMaps">Show map</Label>
            <Switch
              id="showMaps"
              :checked="mapsStore.showMaps"
              @update:checked="(checked: boolean) => (mapsStore.showMaps = checked)"
            />
          </div>
          <div class="space-y-1">
            <Label for="mapDisplayMode">Displayed map</Label>
            <Select v-model="mapsStore.displayMode">
              <SelectTrigger id="mapDisplayMode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (follow robot mapId)</SelectItem>
                <SelectItem
                  v-for="map in mapsStore.maps"
                  :key="map.id"
                  :value="map.id"
                >
                  {{ map.name }}{{ map.mapId ? ` (${map.mapId})` : "" }}
                </SelectItem>
              </SelectContent>
            </Select>
            <p class="text-xs text-muted-foreground">
              Robots report mapId: {{ robotMapIdsText }}
            </p>
          </div>
          <div class="space-y-2">
            <Label>Opacity: {{ opacityValue[0] }}%</Label>
            <Slider v-model="opacityValue" :min="10" :max="100" :step="5" />
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
