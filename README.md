# Modbus Multi-ETH Gateway

[![Home Assistant Add-on](https://img.shields.io/badge/Home%20Assistant-Add--on-blue?logo=homeassistant)](https://www.home-assistant.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Architecture](https://img.shields.io/badge/arch-amd64%20%7C%20aarch64%20%7C%20armv7-lightgrey)](config.yaml)

A Modbus TCP/RTU to MQTT gateway with **multi-Ethernet interface support** and **automatic device discovery**. Fork of [modbus2mqtt](https://github.com/modbus2mqtt/modbus2mqtt/) extended to handle multiple network interfaces simultaneously — ideal for industrial environments with segmented Modbus networks.

---

## What's Different from modbus2mqtt?

| Feature | modbus2mqtt | This Fork |
|---|:---:|:---:|
| Single Ethernet interface | Yes | Yes |
| Multiple Ethernet interfaces | -- | Yes |
| Per-interface IP binding (`localAddress`) | -- | Yes |
| Network interface browser UI | -- | Yes |
| Subnet device auto-discovery | -- | Yes |
| FC 0x2B device identification | -- | Yes |
| Policy routing (per-NIC routing tables) | -- | Yes |

## Key Features

- **Multi-NIC support** — bind each Modbus bus to a specific Ethernet interface; outbound TCP connections use `localAddress` so traffic stays on the right network segment
- **Auto-discovery** — scan any interface's subnet for Modbus devices on ports 502, 8502, and 4196; probe unit IDs 1-247 with FC 0x2B device identification
- **Network Interfaces UI** — browse all host NICs with connection status, IP, MAC, and gateway; one click to scan for devices
- **Device scan results** — view discovered devices with vendor/product info, then add them as buses directly from the results table
- **Interface selector** — choose a network interface when configuring a TCP bus; the system auto-resolves the correct `localAddress`
- **Modbus RTU & TCP** — serial and TCP transports with configurable timeouts
- **MQTT with HA auto-discovery** — `homeassistant/<component>/<node_id>/<object_id>/config` with retained payloads and device grouping
- **Reusable specifications** — register-to-MQTT mappings that can be contributed back to the community
- **Multiple deployment targets** — Home Assistant add-on, Docker, Proxmox LXC, or standalone Node.js

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Home Assistant                      │
│                  (Supervisor)                        │
└──────────┬──────────────────────────────┬────────────┘
           │ MQTT auto-discovery          │ Ingress
           ▼                              ▼
┌─────────────────┐           ┌───────────────────────┐
│   MQTT Broker   │◄──────────│  Modbus Multi-ETH     │
│  (Mosquitto)    │  publish  │  Gateway Container    │
└─────────────────┘           │                       │
                              │  ┌─────────────────┐  │
                              │  │  Web UI (Angular)│  │
                              │  └─────────────────┘  │
                              │  ┌─────────────────┐  │
                              │  │ NetworkManager   │  │
                              │  │ DiscoveryEngine  │  │
                              │  └────────┬────────┘  │
                              └───────────┼───────────┘
                    ┌─────────────────────┼─────────────────────┐
                    │                     │                     │
                    ▼                     ▼                     ▼
             ┌────────────┐       ┌────────────┐       ┌────────────┐
             │   eth0     │       │   eth1     │       │   eth2     │
             │ 10.0.1.x   │       │ 10.0.2.x   │       │ 10.0.3.x   │
             │ Building A │       │ Building B │       │ Building C │
             └─────┬──────┘       └─────┬──────┘       └─────┬──────┘
                   │                    │                    │
              Modbus TCP           Modbus TCP           Modbus TCP
              devices              devices              devices
```

## Quick Start

### Home Assistant Add-on

1. Add this repository to your Home Assistant add-on store
2. Install **Modbus Multi-ETH Gateway**
3. Start the add-on — MQTT credentials are auto-discovered from the Supervisor
4. Open the Web UI via the sidebar, navigate to **Network Interfaces**
5. Select an interface and scan for Modbus devices

### Docker

```bash
docker run -d \
  --name modbus-multi-eth \
  --network host \
  -v ./config:/config \
  -v ./data:/data \
  -e MQTT_HOST=your-mqtt-broker \
  ghcr.io/rellis-erigon/modbus-multi-eth-amd64:latest
```

> `--network host` is required so the container can see and bind to host network interfaces.

### Standalone (Development)

```bash
git clone https://github.com/rellis-erigon/ModBus-HA-Addon-Mutiple-ETH.git
cd ModBus-HA-Addon-Mutiple-ETH/backend
npm install
npm run dev -- -c ../config -d ../data -s ../ssl
```

See [docs/getting-started.md](docs/getting-started.md) for full setup instructions.

## How Multi-Interface Binding Works

The gateway uses a three-tier approach to ensure Modbus traffic routes through the correct NIC:

1. **`localAddress` binding** (primary) — each outbound TCP connection is bound to the selected interface's IP address via Node.js `net.connect({ localAddress })`, which modbus-serial passes through natively
2. **Policy routing** (container setup) — an s6-overlay oneshot service creates per-interface routing tables (`ip rule add from <ip> table <N>`) so the kernel routes replies back through the correct NIC
3. **NetworkManager** — queries the HA Supervisor API (`/network/info`) or falls back to `ip -j addr show` to enumerate interfaces and resolve names to IP addresses

## Auto-Discovery

The discovery engine scans a selected interface's subnet:

1. Computes host range from the interface's IP and prefix length
2. TCP port scans (ports 502, 8502, 4196) with 20-concurrent batching
3. Probes Modbus unit IDs 1-247 on each responding host
4. Attempts FC 0x2B Read Device Identification (via `reportServerID`) for vendor/product info
5. Falls back to reading holding registers 0-3 for device codes
6. Reports results in real-time via polling (`GET /api/network/scan/status`)

Subnets larger than /16 (65,534 hosts) are refused to prevent accidental network flooding.

## Documentation

| Guide | Description |
|---|---|
| [Getting Started](docs/getting-started.md) | First steps: MQTT config, adding a bus, assigning specs |
| [Home Assistant Install](docs/installation-homeassistant.md) | Add-on installation and configuration |
| [Docker Install](docs/installation-docker.md) | Docker deployment guide |
| [Proxmox LXC](docs/installation-proxmox.md) | Proxmox container setup |
| [Authentication](docs/authentication.md) | OIDC, supervisor token, and open-access modes |
| [Development](docs/development.md) | Dev environment, building, and testing |
| [Contributing](docs/contributing.md) | PR workflow, coding standards, spec contributions |

## API Endpoints (Network)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/network/interfaces` | List all host network interfaces |
| `POST` | `/api/network/scan` | Start a device scan on an interface |
| `GET` | `/api/network/scan/status` | Poll scan progress and results |

## Tech Stack

- **Backend**: Node.js 22+, TypeScript, Express
- **Frontend**: Angular 17+, Angular Material
- **Modbus**: modbus-serial ^8.0.17
- **MQTT**: mqtt.js with Home Assistant auto-discovery
- **Container**: Alpine Linux, s6-overlay, iproute2
- **Architectures**: amd64, aarch64, armv7

## Credits

Forked from [modbus2mqtt](https://github.com/modbus2mqtt/modbus2mqtt/) by [volkmarnissen](https://github.com/volkmarnissen). Multi-Ethernet interface support, auto-discovery, and network UI added by this project.

## License

[MIT](LICENSE)
