import Debug from 'debug'
import { Logger, LogLevelEnum } from '../specification/index.js'
import { NetworkManager, INetworkInterface } from './networkManager.js'
import * as net from 'net'

const debug = Debug('discovery')
const log = new Logger('discovery')

export interface IDiscoveredDevice {
  interfaceName: string
  host: string
  port: number
  unitId: number
  respondedAt: string
  deviceIdentification?: {
    vendorName?: string
    productCode?: string
    revision?: string
  }
  matchedSpec?: string
  added: boolean
}

export interface IScanStatus {
  scanning: boolean
  interfaceName?: string
  progress: number
  hostsScanned: number
  hostsTotal: number
  devicesFound: number
  results: IDiscoveredDevice[]
}

const MODBUS_PORTS = [502, 8502, 4196]

export class DiscoveryEngine {
  private static status: IScanStatus = {
    scanning: false,
    progress: 0,
    hostsScanned: 0,
    hostsTotal: 0,
    devicesFound: 0,
    results: [],
  }

  static getStatus(): IScanStatus {
    return DiscoveryEngine.status
  }

  async scanInterface(interfaceName: string, mode: 'quick' | 'standard' | 'targeted' = 'quick'): Promise<IDiscoveredDevice[]> {
    const nm = NetworkManager.getInstance()
    const iface = nm.getInterfaceByName(interfaceName)
    if (!iface) {
      throw new Error(`Interface ${interfaceName} not found`)
    }

    DiscoveryEngine.status = {
      scanning: true,
      interfaceName,
      progress: 0,
      hostsScanned: 0,
      hostsTotal: 0,
      devicesFound: 0,
      results: [],
    }

    try {
      const hosts = this.computeSubnetHosts(iface)
      DiscoveryEngine.status.hostsTotal = hosts.length

      // Phase 1: TCP port scan for Modbus gateways
      const gateways = await this.scanPorts(hosts, iface)
      DiscoveryEngine.status.progress = 50

      // Phase 2: Unit ID probe on discovered gateways
      const devices = await this.probeUnitIds(gateways, iface, mode)
      DiscoveryEngine.status.progress = 100
      DiscoveryEngine.status.scanning = false
      DiscoveryEngine.status.results = devices

      return devices
    } catch (e) {
      DiscoveryEngine.status.scanning = false
      log.log(LogLevelEnum.error, `Scan failed: ${e}`)
      throw e
    }
  }

  private computeSubnetHosts(iface: INetworkInterface): string[] {
    const ip = iface.ipv4Address
    if (!ip) return []

    const parts = ip.split('.').map(Number)
    const prefix = iface.prefixLength
    if (prefix < 16) return [] // refuse to scan anything bigger than /16

    const ipNum = (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]
    const mask = prefix === 32 ? 0xffffffff : (0xffffffff << (32 - prefix)) >>> 0
    const network = (ipNum & mask) >>> 0
    const broadcast = (network | ~mask) >>> 0
    const hosts: string[] = []

    for (let i = network + 1; i < broadcast && hosts.length < 65534; i++) {
      const hostIp = `${(i >>> 24) & 0xff}.${(i >>> 16) & 0xff}.${(i >>> 8) & 0xff}.${i & 0xff}`
      if (hostIp !== ip) hosts.push(hostIp)
    }
    return hosts
  }

  private async scanPorts(hosts: string[], iface: INetworkInterface): Promise<Array<{ host: string; port: number }>> {
    const gateways: Array<{ host: string; port: number }> = []
    const concurrency = 20
    const timeout = 500

    for (let i = 0; i < hosts.length; i += concurrency) {
      const batch = hosts.slice(i, i + concurrency)
      const promises = batch.flatMap((host) =>
        MODBUS_PORTS.map(
          (port) =>
            new Promise<{ host: string; port: number } | null>((resolve) => {
              const socket = new net.Socket()
              socket.setTimeout(timeout)
              socket.once('connect', () => {
                socket.destroy()
                resolve({ host, port })
              })
              socket.once('timeout', () => {
                socket.destroy()
                resolve(null)
              })
              socket.once('error', () => {
                socket.destroy()
                resolve(null)
              })
              const connectOpts: net.TcpSocketConnectOpts = { host, port }
              if (iface.ipv4Address) {
                connectOpts.localAddress = iface.ipv4Address
              }
              socket.connect(connectOpts)
            })
        )
      )
      const results = await Promise.all(promises)
      results.forEach((r) => {
        if (r) gateways.push(r)
      })
      DiscoveryEngine.status.hostsScanned = Math.min(i + concurrency, hosts.length)
      DiscoveryEngine.status.progress = Math.round((DiscoveryEngine.status.hostsScanned / hosts.length) * 50)
    }

    debug('Port scan found %d gateways on %s', gateways.length, iface.name)
    return gateways
  }

  private async probeUnitIds(
    gateways: Array<{ host: string; port: number }>,
    iface: INetworkInterface,
    mode: 'quick' | 'standard' | 'targeted'
  ): Promise<IDiscoveredDevice[]> {
    const devices: IDiscoveredDevice[] = []
    const unitIds = mode === 'quick' ? [1, 2, 3, 10, 100, 247] : Array.from({ length: 247 }, (_, i) => i + 1)

    for (const gw of gateways) {
      for (const unitId of unitIds) {
        try {
          const ModbusRTU = (await import('modbus-serial')).default
          const client = new ModbusRTU()
          const connectOpts: { port: number; localAddress?: string } = { port: gw.port }
          if (iface.ipv4Address) {
            connectOpts.localAddress = iface.ipv4Address
          }
          await Promise.race([
            client.connectTCP(gw.host, connectOpts),
            new Promise((_, reject) => setTimeout(() => reject(new Error('connect timeout')), 1000)),
          ])
          client.setID(unitId)
          client.setTimeout(200)
          try {
            await client.readHoldingRegisters(0, 4)
            const device: IDiscoveredDevice = {
              interfaceName: iface.name,
              host: gw.host,
              port: gw.port,
              unitId,
              respondedAt: new Date().toISOString(),
              added: false,
            }
            devices.push(device)
            DiscoveryEngine.status.devicesFound = devices.length
            debug('Found device at %s:%d unit %d via %s', gw.host, gw.port, unitId, iface.name)
          } catch {
            // unit ID not responding, skip
          }
          client.close(() => {})
        } catch {
          // gateway connect failed, skip remaining unit IDs for this gateway
          break
        }
      }
    }
    return devices
  }
}
