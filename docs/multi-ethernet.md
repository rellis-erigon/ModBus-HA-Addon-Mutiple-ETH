# Multi-Ethernet Interface Guide

This guide covers how to use the multi-Ethernet interface features added to this fork of modbus2mqtt.

## Overview

In industrial environments, Modbus TCP devices are often on separate network segments — Building A on `10.0.1.0/24`, Building B on `10.0.2.0/24`, etc. This fork lets you connect to all of them simultaneously from a single gateway host with multiple NICs.

## Requirements

- A host with two or more Ethernet interfaces (physical NICs, VLANs, or bonds)
- Each interface must have an IPv4 address assigned
- For Home Assistant: add-on must run with `host_network: true` (configured by default)

## How Interface Binding Works

When you assign a network interface to a Modbus bus, the system uses three mechanisms to ensure traffic routes correctly:

### 1. localAddress Binding

Each outbound TCP connection is bound to the selected interface's IP address:

```
net.connect({ host: '10.0.2.100', port: 502, localAddress: '10.0.2.1' })
```

The `modbus-serial` library passes this through to Node.js `net.connect()` natively.

### 2. Policy Routing (Container)

The s6-overlay startup script `setup-network.sh` creates per-interface routing tables:

```bash
# For each interface (e.g., eth1 with IP 10.0.2.1 and gateway 10.0.2.254):
ip rule add from 10.0.2.1/32 table 101
ip route add default via 10.0.2.254 dev eth1 table 101
```

This ensures that packets sourced from a given interface's IP are routed back through that interface.

### 3. NetworkManager Service

The `NetworkManager` class queries the Home Assistant Supervisor API (`/network/info`) or falls back to `ip -j addr show` to enumerate interfaces and resolve interface names to IP addresses.

## Using the Web UI

### Network Interfaces Page

Navigate to **Network Interfaces** (the `settings_ethernet` icon in the header) to see all detected Ethernet interfaces:

- **Status**: Connected (green), Disconnected (orange), or Disabled (red)
- **IP Address**: The interface's IPv4 address and prefix length
- **MAC Address**: Hardware address for identification
- **Gateway**: Default gateway for the interface's subnet

Click **Scan for Devices** on any interface to start auto-discovery.

### Network Dashboard

The **Dashboard** (the `dashboard` icon in the header) shows a live overview:

- **Summary cards**: total interfaces, healthy/degraded/down counts
- **Per-interface cards**: real-time status, latency to gateway, uptime percentage
- **Health history**: expandable bar chart of recent check results

The dashboard auto-refreshes every 10 seconds.

### Device Discovery

The scan page lets you discover Modbus devices on any interface's subnet:

1. Select an interface from the dropdown
2. Choose a scan mode:
   - **Quick**: Probes common unit IDs (1, 2, 3, 10, 100, 247)
   - **Standard**: Probes all unit IDs 1-247 (slower)
   - **Targeted**: For specific devices (future)
3. Click **Start Scan**

The scanner:
- Computes the subnet host range from the interface's IP and prefix length
- TCP port scans ports 502, 8502, and 4196 with 20-concurrent batching
- Probes each responding host for valid Modbus unit IDs
- Attempts FC 0x2B device identification for vendor/product info
- Refuses subnets larger than /16 (65,534 hosts)

### Adding Discovered Devices

After a scan completes:

- **Single add**: Click the **Add** button next to a device to create a bus immediately
- **Batch add**: Check multiple devices, then click **Batch Add Selected** to create all buses at once

Each added device creates a bus bound to the correct network interface, with `localAddress` auto-resolved.

### Configuring Interface on a Bus

When creating or editing a TCP bus manually:

1. Go to **Busses** → **Add Bus** (or edit an existing one)
2. In the TCP connection section, use the **Network Interface** dropdown
3. Select the desired interface (or leave as "Auto" for default routing)
4. The system auto-resolves the interface's IP as `localAddress`

## MQTT Health Topics

The health monitor publishes per-interface status to MQTT:

```
modbus2mqtt/network/<interfaceName>/status
```

Payload (JSON):
```json
{
  "name": "eth0",
  "status": "healthy",
  "lastCheck": "2024-01-15T10:30:00.000Z",
  "latencyMs": 12,
  "consecutiveFailures": 0,
  "uptimePercent": 99.5
}
```

Status values:
- `healthy` — gateway reachable, latency normal
- `degraded` — 1-2 consecutive failures
- `down` — 3+ consecutive failures

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/network/interfaces` | List all host network interfaces |
| `POST` | `/api/network/scan` | Start a device scan on an interface |
| `GET` | `/api/network/scan/status` | Poll scan progress and results |
| `GET` | `/api/network/health` | Current health of all interfaces |
| `GET` | `/api/network/health/history?interface=X` | Health history for an interface |
| `POST` | `/api/network/batch-add` | Batch add discovered devices as buses |

## Troubleshooting

### Interfaces not showing up

- Verify the host has multiple NICs: `ip link show`
- Check that interfaces have IPv4 addresses: `ip addr show`
- For HA add-on: ensure `host_network: true` is in `config.yaml`
- Check logs: `docker logs <container>` or HA add-on logs

### Scans find no devices

- Verify Modbus devices are powered and on the network
- Check that the interface's subnet is correct (matching the devices' network)
- Try a manual connection: `nc -zv <device-ip> 502`
- Ensure no firewall rules block port 502

### Traffic routing to wrong interface

- Check policy routing tables: `ip rule show` and `ip route show table <N>`
- Verify `localAddress` is set on the bus configuration
- Check the s6-overlay setup-network.sh logs in the container

### MQTT health not publishing

- Verify MQTT is connected (check the MQTT configuration page)
- Check the `modbus2mqtt/network/#` topic with a subscriber
- The health monitor starts automatically; check container logs for errors
