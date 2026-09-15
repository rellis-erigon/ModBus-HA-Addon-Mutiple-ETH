#!/command/with-contenv sh
# Setup policy routing for multi-interface Modbus connections
# Each interface gets its own routing table so localAddress binding
# correctly routes traffic out the intended NIC.

set -e

ROUTE_TABLE_BASE=100
TABLE_ID=$ROUTE_TABLE_BASE

echo "=== Setting up multi-interface policy routing ==="

# Get list of ethernet interfaces (skip lo and docker/veth)
for IFACE in $(ip -o link show | awk -F': ' '{print $2}' | grep -v -E '^(lo|docker|veth|br-)'); do
  # Get the IPv4 address for this interface
  ADDR=$(ip -4 addr show "$IFACE" 2>/dev/null | grep -oP 'inet \K[\d.]+' | head -1)
  if [ -z "$ADDR" ]; then
    continue
  fi

  # Get the gateway for this interface (if any)
  GW=$(ip -4 route show dev "$IFACE" | grep default | awk '{print $3}' | head -1)
  # Get the subnet
  SUBNET=$(ip -4 addr show "$IFACE" | grep -oP 'inet \K[\d./]+' | head -1)

  TABLE_ID=$((TABLE_ID + 1))

  echo "Interface: $IFACE, Address: $ADDR, Subnet: $SUBNET, Gateway: ${GW:-none}, Table: $TABLE_ID"

  # Add routing table entry if not already present
  if ! grep -q "^${TABLE_ID}" /etc/iproute2/rt_tables 2>/dev/null; then
    echo "${TABLE_ID} modbus_${IFACE}" >> /etc/iproute2/rt_tables
  fi

  # Add policy rule: traffic from this IP uses this table
  ip rule add from "$ADDR" table "$TABLE_ID" priority "$TABLE_ID" 2>/dev/null || true

  # Add route for the local subnet
  if [ -n "$SUBNET" ]; then
    ip route add "$SUBNET" dev "$IFACE" table "$TABLE_ID" 2>/dev/null || true
  fi

  # Add default route via the gateway if one exists
  if [ -n "$GW" ]; then
    ip route add default via "$GW" dev "$IFACE" table "$TABLE_ID" 2>/dev/null || true
  fi
done

echo "=== Policy routing setup complete ==="
