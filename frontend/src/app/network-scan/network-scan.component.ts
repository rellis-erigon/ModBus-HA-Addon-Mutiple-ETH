import { Component, OnInit, OnDestroy } from '@angular/core'
import { CommonModule } from '@angular/common'
import { ActivatedRoute, Router } from '@angular/router'
import { FormsModule } from '@angular/forms'
import { ApiService } from '../services/api-service'
import { MatCard, MatCardHeader, MatCardTitle, MatCardContent } from '@angular/material/card'
import { MatIcon } from '@angular/material/icon'
import { MatButton, MatIconButton } from '@angular/material/button'
import { MatTooltip } from '@angular/material/tooltip'
import { MatProgressBarModule } from '@angular/material/progress-bar'
import { MatSelectModule } from '@angular/material/select'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatTableModule } from '@angular/material/table'
import { MatChipsModule } from '@angular/material/chips'
import { Subscription, interval } from 'rxjs'
import { switchMap, takeWhile } from 'rxjs/operators'

interface DiscoveredDevice {
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

interface ScanStatus {
  scanning: boolean
  interfaceName?: string
  progress: number
  hostsScanned: number
  hostsTotal: number
  devicesFound: number
  results: DiscoveredDevice[]
}

@Component({
  selector: 'app-network-scan',
  templateUrl: './network-scan.component.html',
  styleUrls: ['./network-scan.component.css'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCard,
    MatCardHeader,
    MatCardTitle,
    MatCardContent,
    MatIcon,
    MatButton,
    MatIconButton,
    MatTooltip,
    MatProgressBarModule,
    MatSelectModule,
    MatFormFieldModule,
    MatTableModule,
    MatChipsModule,
  ],
})
export class NetworkScanComponent implements OnInit, OnDestroy {
  interfaceName = ''
  scanMode: 'quick' | 'standard' | 'targeted' = 'quick'
  scanning = false
  status: ScanStatus = {
    scanning: false,
    progress: 0,
    hostsScanned: 0,
    hostsTotal: 0,
    devicesFound: 0,
    results: [],
  }
  results: DiscoveredDevice[] = []
  displayedColumns = ['host', 'port', 'unitId', 'identification', 'spec', 'actions']
  private pollSub: Subscription | null = null

  constructor(
    private apiService: ApiService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.route.queryParams.subscribe((params) => {
      if (params['interface']) {
        this.interfaceName = params['interface']
      }
    })
  }

  ngOnDestroy(): void {
    this.stopPolling()
  }

  startScan(): void {
    if (!this.interfaceName) return
    this.scanning = true
    this.results = []
    this.status = {
      scanning: true,
      interfaceName: this.interfaceName,
      progress: 0,
      hostsScanned: 0,
      hostsTotal: 0,
      devicesFound: 0,
      results: [],
    }

    this.apiService.startNetworkScan(this.interfaceName, this.scanMode).subscribe({
      next: (result) => {
        this.results = result.results || result
        this.scanning = false
        this.status.scanning = false
        this.status.progress = 100
        this.status.results = this.results
        this.status.devicesFound = this.results.length
      },
      error: () => {
        this.scanning = false
        this.status.scanning = false
      },
    })

    this.startPolling()
  }

  private startPolling(): void {
    this.stopPolling()
    this.pollSub = interval(2000)
      .pipe(
        switchMap(() => this.apiService.getNetworkScanStatus()),
        takeWhile((status: ScanStatus) => status.scanning, true)
      )
      .subscribe((status: ScanStatus) => {
        this.status = status
        if (status.results && status.results.length > 0) {
          this.results = status.results
        }
        if (!status.scanning) {
          this.scanning = false
          this.stopPolling()
        }
      })
  }

  private stopPolling(): void {
    if (this.pollSub) {
      this.pollSub.unsubscribe()
      this.pollSub = null
    }
  }

  addDevice(device: DiscoveredDevice): void {
    const connection = {
      host: device.host,
      port: device.port,
      timeout: 1000,
      networkInterface: device.interfaceName,
    }
    this.apiService.postBus(connection).subscribe({
      next: (result) => {
        device.added = true
        this.router.navigate(['/slaves', result.busid])
      },
      error: () => {
        alert('Failed to add device as bus')
      },
    })
  }

  getDeviceName(device: DiscoveredDevice): string {
    if (device.deviceIdentification?.vendorName) {
      return `${device.deviceIdentification.vendorName} ${device.deviceIdentification.productCode || ''}`
    }
    return 'Unknown'
  }

  backToInterfaces(): void {
    this.router.navigate(['/network'])
  }
}
