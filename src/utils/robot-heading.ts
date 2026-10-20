/**
 * Heading arrows of the robots on the graph. The graph uses metres with the
 * y axis flipped (graph y = -map y), so a counterclockwise agvPosition.theta
 * points up on screen.
 */

const ROBOT_NODE_PREFIX = "robot_";

/** Radius of the robot node in screen pixels (see utils/configs.ts) */
const ROBOT_RADIUS_PX = 15;
const TIP_PX = ROBOT_RADIUS_PX + 12;
const BASE_PX = ROBOT_RADIUS_PX - 1;
const HALF_WIDTH_PX = 7;

export interface RobotHeading {
  key: string;
  /** Graph coordinates */
  x: number;
  y: number;
  /** agvPosition.theta in radians, counterclockwise */
  theta: number;
}

/** Robots with a known position and theta */
export function robotHeadings(
  nodes: Record<string, any>,
  layouts: Record<string, { x: number; y: number } | undefined>
): RobotHeading[] {
  return Object.entries(nodes).flatMap(([key, node]) => {
    const position = layouts[key];
    if (
      !key.startsWith(ROBOT_NODE_PREFIX) ||
      !position ||
      typeof node?.theta !== "number" ||
      !Number.isFinite(node.theta)
    ) {
      return [];
    }
    return [{ key, x: position.x, y: position.y, theta: node.theta }];
  });
}

/** Point at a distance (screen pixels) and angle from the robot */
function offset(
  heading: RobotHeading,
  distancePx: number,
  angle: number,
  scale: number
) {
  return {
    x: heading.x + Math.cos(angle) * distancePx * scale,
    // y is flipped in the graph
    y: heading.y - Math.sin(angle) * distancePx * scale,
  };
}

/**
 * SVG points of the arrow head just outside the robot circle, pointing along
 * theta. scale converts screen pixels to graph units (1 / zoom).
 */
export function headingArrowPoints(
  heading: RobotHeading,
  scale: number
): string {
  const tip = offset(heading, TIP_PX, heading.theta, scale);
  const base = offset(heading, BASE_PX, heading.theta, scale);
  const side = heading.theta + Math.PI / 2;
  const dx = Math.cos(side) * HALF_WIDTH_PX * scale;
  const dy = -Math.sin(side) * HALF_WIDTH_PX * scale;
  const round = (value: number) => Math.round(value * 10000) / 10000;
  return [
    [tip.x, tip.y],
    [base.x + dx, base.y + dy],
    [base.x - dx, base.y - dy],
  ]
    .map(([x, y]) => `${round(x)},${round(y)}`)
    .join(" ");
}

/** End of the line inside the robot circle that marks the heading */
export function headingLineEnd(heading: RobotHeading, scale: number) {
  return offset(heading, ROBOT_RADIUS_PX - 3, heading.theta, scale);
}
