import { load } from "js-yaml";

/**
 * ROS map_server metadata (the YAML file next to the map image).
 * origin is the pose [x, y, yaw] of the lower-left pixel in the map frame.
 */
export interface RosMapMetadata {
  image?: string;
  resolution: number;
  origin: [number, number, number];
}

/**
 * Position of a map image in network graph coordinates.
 * The graph uses metres with the y axis flipped (graph y = -map y).
 */
export interface MapPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  /** SVG transform that applies the map yaw around the map origin */
  transform: string;
}

/**
 * Parses a ROS map YAML file. Throws if resolution or origin is missing or invalid.
 */
export function parseRosMapYaml(text: string): RosMapMetadata {
  const data = load(text) as Record<string, unknown> | null;
  if (!data || typeof data !== "object") {
    throw new Error("Map YAML is empty or not a mapping");
  }

  const resolution = Number(data.resolution);
  if (!Number.isFinite(resolution) || resolution <= 0) {
    throw new Error("Map YAML has no valid 'resolution'");
  }

  const origin = data.origin;
  if (
    !Array.isArray(origin) ||
    origin.length < 2 ||
    !origin.slice(0, 3).every((value) => Number.isFinite(Number(value)))
  ) {
    throw new Error("Map YAML has no valid 'origin' [x, y, yaw]");
  }

  return {
    image: typeof data.image === "string" ? data.image : undefined,
    resolution,
    origin: [Number(origin[0]), Number(origin[1]), Number(origin[2] ?? 0)],
  };
}

/**
 * Computes where a map image of the given pixel size is drawn in the graph.
 */
export function computeMapPlacement(
  metadata: RosMapMetadata,
  pixelWidth: number,
  pixelHeight: number
): MapPlacement {
  const [originX, originY, yaw] = metadata.origin;
  const width = pixelWidth * metadata.resolution;
  const height = pixelHeight * metadata.resolution;

  // The lower-left corner of the image sits on the origin. Because the graph
  // y axis is flipped, a counterclockwise map yaw is a negative SVG rotation.
  const yawDegrees = (-yaw * 180) / Math.PI;
  return {
    x: originX,
    y: -(originY + height),
    width,
    height,
    transform: yaw === 0 ? "" : `rotate(${yawDegrees} ${originX} ${-originY})`,
  };
}
