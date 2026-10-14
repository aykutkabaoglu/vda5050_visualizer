# VDA5050 Visualizer

[![Build macOS](https://github.com/bekirbostanci/vda5050_visualizer/actions/workflows/build-macos.yml/badge.svg)](https://github.com/bekirbostanci/vda5050_visualizer/actions/workflows/build-macos.yml)
[![Build Windows](https://github.com/bekirbostanci/vda5050_visualizer/actions/workflows/build-windows.yml/badge.svg)](https://github.com/bekirbostanci/vda5050_visualizer/actions/workflows/build-windows.yml)
[![Build Linux](https://github.com/bekirbostanci/vda5050_visualizer/actions/workflows/build-linux.yml/badge.svg)](https://github.com/bekirbostanci/vda5050_visualizer/actions/workflows/build-linux.yml)


https://github.com/bekirbostanci/vda5050_visualizer/assets/26343575/06f22e56-1547-451b-97b9-870a715d525e

A visualization tool for VDA5050 AGVs (Automated Guided Vehicles) that supports both WebSocket and Electron IPC MQTT connections.

## Shared MQTT Client

The application uses a shared MQTT client to optimize connection management and prevent multiple connections when one already exists. This approach provides several benefits:

1. **Efficiency**: Only one MQTT connection is created, regardless of how many AGVs are being monitored
2. **Simplicity**: Components can subscribe to specific topics without managing the connection
3. **Reliability**: Connection management is centralized, making it easier to handle reconnections
4. **Flexibility**: Works with both WebSocket and Electron IPC approaches

### Key Components

- **SharedMqttClient**: A singleton class that manages a single MQTT connection shared across the application
- **VDA5050Agv**: Controller for individual AGVs that uses the shared client for WebSocket connections
- **VDA5050Visualizer**: Component that creates and manages the shared client for the application
- **VDA5050Controller**: Main controller that coordinates AGV instances and message routing

### Usage Example

```typescript
import { sharedMqttClient } from "./utils/shared-mqtt-client";

// Connect to the MQTT broker
await sharedMqttClient.connect(
  "localhost",
  "9001",
  "client_id",
  "username",
  "password"
);

// Subscribe to topics
sharedMqttClient.subscribe(["topic1", "topic2"]);

// Subscribe to messages
const unsubscribe = sharedMqttClient.subscribeToMessages((topic, message) => {
  console.log(`Received message on ${topic}:`, message);
});

// Publish a message
sharedMqttClient.publish("topic", { data: "value" });

// Unsubscribe from messages when done
unsubscribe();

// Disconnect when the application is shutting down
// Note: This will disconnect all components using the shared client
sharedMqttClient.disconnect();
```

## Connection Types

The application supports two types of MQTT connections:

1. **WebSocket**: Direct connection to an MQTT broker via WebSocket
2. **Electron IPC**: Connection via Electron's IPC mechanism (for desktop applications)

The connection type can be configured in the application settings.

## Desktop Application

VDA5050 Visualizer is also available as a desktop application built with Electron. The desktop version provides all the features of the web application plus native desktop integration.

### Running the Desktop App in Development

To run the desktop application in development mode:

```bash
npm run electron:dev
```

This will start both the Vite development server and the Electron application.

### Building the Desktop App

To build the desktop application for distribution:

```bash
npm run electron:build
```

This will create platform-specific installers in the `dist_electron` directory. The application is configured to build for:

- Windows (.exe installer)
- macOS (.dmg)
- Linux (AppImage)

### Auto Updates

The desktop application supports automatic updates through GitHub releases. When a new version is published, the application will automatically detect and prompt users to install the update.

## Development

### Prerequisites

- Node.js 24+
- npm or yarn

### Installation

```bash
npm install
```

### Running the Application

```bash
npm run dev
```

### Building for Production

```bash
npm run build
```

## VDA5050 Visualizer

The purpose of this package is to view and visualize vda5050 messages more quickly without looking at the json data. After running the application, you need to press the start button.

![Web Interface](docs/1.png)

![Desktop Interface](docs/2.png)

- Display all robots on the one graph
- Displaying the real-time position of multiple robots, with an arrow showing each robot's orientation (`agvPosition.theta` from the state or visualization message)
- Displaying the vda5050 actions that robots perform
- Displaying data from the master controller to the robot and from the robot to the master controller
- Display of raw json data; every object and array can be collapsed with its arrow (the collapsed sections stay collapsed while new messages arrive), and the viewer header has Expand all / Collapse all
- Map image behind the graph (ROS map PNG + YAML)

### Map Background

Open **Maps** in the top bar and load a ROS map image (PNG) together with its map_server YAML file. The image is placed in the map frame with `resolution` and `origin` (`[x, y, yaw]`, the pose of the lower-left pixel), so it lines up with `agvPosition` and the order node positions.

Each map can carry a VDA5050 `mapId`. In **Auto** mode the visualizer shows the maps whose `mapId` a robot reports in `agvPosition.mapId`. If no map matches, it shows the maps without a `mapId`, otherwise the first loaded map. A specific map can also be selected. **View → Show Map** toggles the map, and the dialog sets its opacity. Loaded maps are saved in the browser's localStorage.

### Factsheet Actions

The order and instant action editors take their action types from the AGV factsheet (`protocolFeatures.agvActions`). Instant actions list the actions with the `INSTANT` scope, node and edge actions the ones with the `NODE` and `EDGE` scope. Selecting an action adds its required parameters and limits the blocking type to the allowed ones. Parameter values are converted by `valueDataType` (e.g. `FLOAT` → number, `OBJECT` → JSON object) and invalid values are marked. Optional parameters can be added with one click, and custom action types and free-form parameters are still possible.

**Load Factsheet** subscribes to the factsheet topic again, so the broker sends the retained factsheet (VDA5050 2.1.0, 6.15). If none arrives within 2 s, it sends a `factsheetRequest` instant action and waits 5 s. Without a factsheet the editors offer the standard VDA5050 actions. A factsheet that arrives wrapped as `{"data": "<json>"}` (e.g. a string message forwarded by a bridge) is accepted and marked in the editor.

### Updates

- Actions are listing on the path
- Action nodes and edges color are changing

## Live Demo

Check out the live demo of this project [here](https://vda5050-visualizer.vercel.app/).

## Install

Before than run app, please go to folder and install npm packages

```
npm install
```

## Run

```
npm run dev
```

## MQTT Broker Settings

Note Modern web browsers (google chrome, firefox, opera etc.) cannot access the mqtt protocol directly. Therefore, if you want to use this application, please first enable the use of web sockets in your mqtt broker settings

`sudo nano /etc/mosquitto/mosquitto.conf`

```
per_listener_settings true
listener 1883
allow_anonymous true

listener 14520
protocol websockets
allow_anonymous true
```
