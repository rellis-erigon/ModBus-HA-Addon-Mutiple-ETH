import Debug from 'debug'
import * as net from 'net'
import { Logger, LogLevelEnum } from '../specification/index.js'
import { NetworkManager, INetworkInterface } from './networkManager.js'
import { MqttConnector } from './mqttconnector.js'
import { Config } from './config.js'

const debug = Debug('health')
const log = new Logger('health')

export interface IHealthCheck {
  timestamp: string
  success: boolean
  latencyMs: number | null
}

export interface IInterfaceHealth {
  name: string
  status: 'healthy' | 'degraded' | 'down'
  lastCheck: string
  latencyMs: number | null
  consecutiveFailures: number
  uptimePercent: number
}

const CHECK_INTERVAL_MS = 30_000
const GATEWAY_CONNECT_TIMEOUT_MS = 2_000
const GATEWAY_PORT = 80
const MAX_HISTORY = 100

export class InterfaceHealthMonitor {
  private static instance: InterfaceHealthMonitor

  private timer: ReturnType<typeof setInterval> | undefined
  private healthMap: Map<string, IInterfaceHealth> = new Map()
  private historyMap: Map<string, IHealthCheck[]> = new Map()

  private constructor() {}

  static getInstance(): InterfaceHealthMonitor {
    if (!InterfaceHealthMonitor.instance) {
      InterfaceHealthMonitor.instance = new InterfaceHealthMonitor()
    }
    return InterfaceHealthMonitor.instance
  }

  async start(): Promise<void> {
    if (this.timer) return
    debug('Starting interface health monitor')
    await NetworkManager.getInstance().refreshInterfaces()
    await this.runCheck()
    this.timer = setInterval(() => {
      this.runCheck().catch((e) => {
        log.log(LogLevelEnum.error, `Health check cycle failed: ${e}`)
      })
    }, CHECK_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
      debug('Stopped interface health monitor')
    }
  }

  getHealthStatus(): IInterfaceHealth[] {
    return Array.from(this.healthMap.values())
  }

  getHealthHistory(interfaceName: string): IHealthCheck[] {
    return this.historyMap.get(interfaceName) ?? []
  }

  private async runCheck(): Promise<void> {
    const interfaces = NetworkManager.getInstance().getInterfaces()
    for (const iface of interfaces) {
      await this.checkInterface(iface)
    }
    this.publishHealthMqtt()
  }

  private async checkInterface(iface: INetworkInterface): Promise<void> {
    const start = Date.now()
    let success = false
    let latencyMs: number | null = null

    if (iface.gateway) {
      try {
        latencyMs = await this.pingGateway(iface.gateway, iface.ipv4Address)
        success = true
      } catch {
        // Gateway ping failed, fall back to interface state
        success = iface.connected && iface.enabled
      }
    } else {
      // No gateway, check interface state via NetworkManager
      const current = NetworkManager.getInstance().getInterfaceByName(iface.name)
      success = current ? current.connected && current.enabled : false
    }

    const now = new Date().toISOString()
    const check: IHealthCheck = { timestamp: now, success, latencyMs }

    // Update history
    let history = this.historyMap.get(iface.name)
    if (!history) {
      history = []
      this.historyMap.set(iface.name, history)
    }
    history.push(check)
    if (history.length > MAX_HISTORY) {
      history.splice(0, history.length - MAX_HISTORY)
    }

    // Compute consecutive failures
    let consecutiveFailures = 0
    for (let i = history.length - 1; i >= 0; i--) {
      if (!history[i].success) consecutiveFailures++
      else break
    }

    // Compute uptime percent
    const successCount = history.filter((h) => h.success).length
    const uptimePercent = history.length > 0 ? Math.round((successCount / history.length) * 10000) / 100 : 0

    // Determine status
    let status: 'healthy' | 'degraded' | 'down'
    if (consecutiveFailures === 0) {
      status = 'healthy'
    } else if (consecutiveFailures >= 3) {
      status = 'down'
    } else {
      status = 'degraded'
    }

    const health: IInterfaceHealth = {
      name: iface.name,
      status,
      lastCheck: now,
      latencyMs,
      consecutiveFailures,
      uptimePercent,
    }
    this.healthMap.set(iface.name, health)
    debug('Interface %s: %s (latency=%s, failures=%d)', iface.name, status, latencyMs ?? 'n/a', consecutiveFailures)
  }

  private pingGateway(gateway: string, localAddress?: string): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const start = Date.now()
      const socket = new net.Socket()
      socket.setTimeout(GATEWAY_CONNECT_TIMEOUT_MS)

      socket.once('connect', () => {
        const latency = Date.now() - start
        socket.destroy()
        resolve(latency)
      })

      socket.once('timeout', () => {
        socket.destroy()
        reject(new Error('Gateway ping timeout'))
      })

      socket.once('error', (err) => {
        socket.destroy()
        reject(err)
      })

      const connectOpts: net.TcpSocketConnectOpts = { host: gateway, port: GATEWAY_PORT }
      if (localAddress) {
        connectOpts.localAddress = localAddress
      }
      socket.connect(connectOpts)
    })
  }

  private publishHealthMqtt(): void {
    try {
      const connector = MqttConnector.getInstance()
      if (!connector.isConnected()) return

      const baseTopic = Config.getConfiguration().mqttbasetopic || 'modbus2mqtt'
      connector.getMqttClient((mqttClient) => {
        for (const health of this.healthMap.values()) {
          const topic = `${baseTopic}/network/${health.name}/status`
          mqttClient.publish(topic, JSON.stringify(health), { retain: true })
        }
      })
    } catch {
      // MQTT not available, skip publishing
      debug('MQTT not available, skipping health publish')
    }
  }
}
