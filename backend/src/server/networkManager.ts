import Debug from 'debug'
import { Logger, LogLevelEnum } from '../specification/index.js'

const debug = Debug('network')
const log = new Logger('network')

export interface INetworkInterface {
  name: string
  ipv4Address: string
  prefixLength: number
  mac: string
  enabled: boolean
  connected: boolean
  gateway?: string
  type: string
}

export class NetworkManager {
  private static instance: NetworkManager
  private interfaces: INetworkInterface[] = []
  private supervisorHost: string
  private hassioToken: string | undefined

  private constructor() {
    this.supervisorHost = process.env.SUPERVISOR_HOST || 'supervisor'
    this.hassioToken = process.env.SUPERVISOR_TOKEN || process.env.HASSIO_TOKEN
  }

  static getInstance(): NetworkManager {
    if (!NetworkManager.instance) {
      NetworkManager.instance = new NetworkManager()
    }
    return NetworkManager.instance
  }

  getInterfaces(): INetworkInterface[] {
    return this.interfaces
  }

  getInterfaceByName(name: string): INetworkInterface | undefined {
    return this.interfaces.find((i) => i.name === name)
  }

  async refreshInterfaces(): Promise<INetworkInterface[]> {
    if (this.hassioToken) {
      try {
        const resp = await fetch(`http://${this.supervisorHost}/network/info`, {
          headers: { Authorization: `Bearer ${this.hassioToken}` },
        })
        if (resp.ok) {
          const data = (await resp.json()) as {
            data: {
              interfaces: Array<{
                interface: string
                type: string
                enabled: boolean
                connected: boolean
                mac: string
                ipv4?: {
                  address?: string[]
                  gateway?: string
                  method?: string
                  ready?: boolean
                }
              }>
            }
          }
          this.interfaces = data.data.interfaces
            .filter((iface) => iface.type === 'ethernet' || iface.type === 'vlan')
            .map((iface) => {
              const addr = iface.ipv4?.address?.[0] || ''
              const [ip, prefix] = addr.includes('/') ? addr.split('/') : [addr, '24']
              return {
                name: iface.interface,
                ipv4Address: ip,
                prefixLength: parseInt(prefix, 10),
                mac: iface.mac || '',
                enabled: iface.enabled,
                connected: iface.connected,
                gateway: iface.ipv4?.gateway,
                type: iface.type,
              }
            })
          debug('Refreshed interfaces from Supervisor: %d found', this.interfaces.length)
          return this.interfaces
        }
        log.log(LogLevelEnum.error, `Supervisor /network/info returned ${resp.status}`)
      } catch (e) {
        log.log(LogLevelEnum.error, `Failed to query Supervisor: ${e}`)
      }
    }

    // Fallback: parse from /proc/net or ip command
    try {
      const { execSync } = await import('child_process')
      const output = execSync('ip -j addr show', { encoding: 'utf-8' })
      const parsed = JSON.parse(output) as Array<{
        ifname: string
        address: string
        operstate: string
        link_type: string
        addr_info: Array<{ family: string; local: string; prefixlen: number }>
      }>
      this.interfaces = parsed
        .filter((iface) => iface.link_type === 'ether' && iface.ifname !== 'lo')
        .map((iface) => {
          const v4 = iface.addr_info?.find((a) => a.family === 'inet')
          return {
            name: iface.ifname,
            ipv4Address: v4?.local || '',
            prefixLength: v4?.prefixlen || 24,
            mac: iface.address || '',
            enabled: true,
            connected: iface.operstate === 'UP',
            type: 'ethernet',
          }
        })
        .filter((iface) => iface.ipv4Address !== '')
      debug('Refreshed interfaces from ip command: %d found', this.interfaces.length)
    } catch (e) {
      log.log(LogLevelEnum.error, `Failed to enumerate interfaces: ${e}`)
      this.interfaces = []
    }
    return this.interfaces
  }

  getLocalAddressForInterface(interfaceName: string): string | undefined {
    const iface = this.getInterfaceByName(interfaceName)
    return iface?.ipv4Address
  }
}
