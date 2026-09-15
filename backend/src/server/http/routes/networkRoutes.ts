import Debug from 'debug'
import { HttpErrorsEnum } from '../../../shared/specification/index.js'
import { apiUri } from '../../../shared/server/index.js'
import { ApiError, Registrar, ok, created } from '../routeHelpers.js'
import { NetworkManager } from '../../networkManager.js'
import { DiscoveryEngine } from '../../discoveryEngine.js'
import { InterfaceHealthMonitor } from '../../interfaceHealthMonitor.js'
import { Bus } from '../../bus.js'

const debug = Debug('httpserver')

export function registerNetworkRoutes(r: Registrar): void {
  r.get(apiUri.networkInterfaces, () => {
    return ok(NetworkManager.getInstance().getInterfaces())
  })

  r.post(apiUri.networkScan, async (ctx) => {
    const { interfaceName, mode } = ctx.body as { interfaceName: string; mode?: 'quick' | 'standard' | 'targeted' }
    if (!interfaceName) {
      throw new ApiError(HttpErrorsEnum.ErrBadRequest, 'interfaceName is required')
    }
    const engine = new DiscoveryEngine()
    const results = await engine.scanInterface(interfaceName, mode ?? 'quick')
    return ok(results)
  })

  r.get(apiUri.networkScanStatus, () => {
    return ok(DiscoveryEngine.getStatus())
  })

  r.post(apiUri.networkBatchAdd, async (ctx) => {
    const { devices } = ctx.body as {
      devices: Array<{ host: string; port: number; unitId: number; interfaceName: string }>
    }
    if (!devices || !Array.isArray(devices) || devices.length === 0) {
      throw new ApiError(HttpErrorsEnum.ErrBadRequest, 'devices array is required and must not be empty')
    }

    let added = 0
    const failed: Array<{ device: { host: string; port: number; unitId: number; interfaceName: string }; error: string }> = []

    for (const device of devices) {
      try {
        const nm = NetworkManager.getInstance()
        const localAddress = nm.getLocalAddressForInterface(device.interfaceName)
        const connectionData = {
          host: device.host,
          port: device.port,
          timeout: 1000,
          networkInterface: device.interfaceName,
          localAddress: localAddress,
        }
        await Bus.addBus(connectionData)
        added++
        debug('Batch add: created bus for %s:%d via %s', device.host, device.port, device.interfaceName)
      } catch (e) {
        failed.push({ device, error: e instanceof Error ? e.message : String(e) })
        debug('Batch add: failed for %s:%d - %s', device.host, device.port, e)
      }
    }

    return ok({ added, failed })
  })

  r.get(apiUri.networkHealth, () => {
    return ok(InterfaceHealthMonitor.getInstance().getHealthStatus())
  })

  r.get(apiUri.networkHealthHistory, (ctx) => {
    const interfaceName = ctx.query['interface']
    if (!interfaceName) {
      throw new ApiError(HttpErrorsEnum.ErrBadRequest, 'interface query parameter is required')
    }
    return ok(InterfaceHealthMonitor.getInstance().getHealthHistory(interfaceName))
  })
}
