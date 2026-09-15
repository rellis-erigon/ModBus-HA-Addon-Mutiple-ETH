import Debug from 'debug'
import { HttpErrorsEnum } from '../../../shared/specification/index.js'
import { apiUri } from '../../../shared/server/index.js'
import { ApiError, Registrar, ok } from '../routeHelpers.js'
import { NetworkManager } from '../../networkManager.js'
import { DiscoveryEngine } from '../../discoveryEngine.js'

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
}
