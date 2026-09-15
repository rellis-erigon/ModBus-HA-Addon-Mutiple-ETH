import { Component, OnInit } from '@angular/core'
import { CommonModule } from '@angular/common'
import { Router } from '@angular/router'
import { ApiService } from '../services/api-service'
import { MatCard, MatCardHeader, MatCardTitle, MatCardContent, MatCardActions } from '@angular/material/card'
import { MatIcon } from '@angular/material/icon'
import { MatButton, MatIconButton } from '@angular/material/button'
import { MatTooltip } from '@angular/material/tooltip'
import { MatChipsModule } from '@angular/material/chips'
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner'

interface NetworkInterface {
  name: string
  ipv4Address: string
  prefixLength: number
  mac: string
  enabled: boolean
  connected: boolean
  gateway?: string
  type: string
}

@Component({
  selector: 'app-network-interfaces',
  templateUrl: './network-interfaces.component.html',
  styleUrls: ['./network-interfaces.component.css'],
  standalone: true,
  imports: [
    CommonModule,
    MatCard,
    MatCardHeader,
    MatCardTitle,
    MatCardContent,
    MatCardActions,
    MatIcon,
    MatButton,
    MatIconButton,
    MatTooltip,
    MatChipsModule,
    MatProgressSpinnerModule,
  ],
})
export class NetworkInterfacesComponent implements OnInit {
  interfaces: NetworkInterface[] = []
  loading = true
  error: string | null = null

  constructor(
    private apiService: ApiService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.loadInterfaces()
  }

  loadInterfaces(): void {
    this.loading = true
    this.error = null
    this.apiService.getNetworkInterfaces().subscribe({
      next: (interfaces) => {
        this.interfaces = interfaces
        this.loading = false
      },
      error: () => {
        this.error = 'Failed to load network interfaces'
        this.loading = false
      },
    })
  }

  scanInterface(iface: NetworkInterface): void {
    this.router.navigate(['/scan'], { queryParams: { interface: iface.name } })
  }

  getStatusColor(iface: NetworkInterface): string {
    if (!iface.enabled) return 'warn'
    if (!iface.connected) return 'accent'
    return 'primary'
  }

  getStatusText(iface: NetworkInterface): string {
    if (!iface.enabled) return 'Disabled'
    if (!iface.connected) return 'Disconnected'
    return 'Connected'
  }
}
