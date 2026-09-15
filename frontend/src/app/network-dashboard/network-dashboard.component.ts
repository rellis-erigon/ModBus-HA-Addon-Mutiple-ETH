import { Component, OnInit, OnDestroy } from '@angular/core'
import { CommonModule } from '@angular/common'
import { Router } from '@angular/router'
import { ApiService } from '../services/api-service'
import { MatCard, MatCardHeader, MatCardTitle, MatCardContent } from '@angular/material/card'
import { MatIcon } from '@angular/material/icon'
import { MatButton, MatIconButton } from '@angular/material/button'
import { MatTooltip } from '@angular/material/tooltip'
import { MatChipsModule } from '@angular/material/chips'
import { MatProgressBarModule } from '@angular/material/progress-bar'
import { Subscription, interval } from 'rxjs'
import { switchMap } from 'rxjs/operators'

interface NetworkHealthEntry {
  name: string
  ip: string
  mac: string
  status: 'healthy' | 'degraded' | 'down'
  latencyMs: number
  uptimePercent: number
  deviceCount: number
}

interface HealthHistoryEntry {
  timestamp: string
  latencyMs: number
  status: 'healthy' | 'degraded' | 'down'
}

@Component({
  selector: 'app-network-dashboard',
  templateUrl: './network-dashboard.component.html',
  styleUrls: ['./network-dashboard.component.css'],
  standalone: true,
  imports: [
    CommonModule,
    MatCard,
    MatCardHeader,
    MatCardTitle,
    MatCardContent,
    MatIcon,
    MatButton,
    MatIconButton,
    MatTooltip,
    MatChipsModule,
    MatProgressBarModule,
  ],
})
export class NetworkDashboardComponent implements OnInit, OnDestroy {
  interfaces: NetworkHealthEntry[] = []
  expandedHistory: { [name: string]: HealthHistoryEntry[] } = {}
  loading = true

  private refreshSub: Subscription | null = null

  constructor(
    private apiService: ApiService,
    private router: Router
  ) {}

  get totalCount(): number {
    return this.interfaces.length
  }

  get healthyCount(): number {
    return this.interfaces.filter((i) => i.status === 'healthy').length
  }

  get degradedCount(): number {
    return this.interfaces.filter((i) => i.status === 'degraded').length
  }

  get downCount(): number {
    return this.interfaces.filter((i) => i.status === 'down').length
  }

  ngOnInit(): void {
    this.loadHealth()
    this.refreshSub = interval(10000)
      .pipe(switchMap(() => this.apiService.getNetworkHealth()))
      .subscribe((data) => {
        this.interfaces = data
        this.loading = false
      })
  }

  ngOnDestroy(): void {
    if (this.refreshSub) {
      this.refreshSub.unsubscribe()
      this.refreshSub = null
    }
  }

  private loadHealth(): void {
    this.apiService.getNetworkHealth().subscribe((data) => {
      this.interfaces = data
      this.loading = false
    })
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'healthy':
        return '#4caf50'
      case 'degraded':
        return '#ff9800'
      case 'down':
        return '#f44336'
      default:
        return '#9e9e9e'
    }
  }

  goToScan(interfaceName: string): void {
    this.router.navigate(['/scan'], { queryParams: { interface: interfaceName } })
  }

  toggleHistory(interfaceName: string): void {
    if (this.expandedHistory[interfaceName]) {
      delete this.expandedHistory[interfaceName]
    } else {
      this.apiService.getNetworkHealthHistory(interfaceName).subscribe((history) => {
        this.expandedHistory[interfaceName] = history
      })
    }
  }

  isHistoryExpanded(interfaceName: string): boolean {
    return !!this.expandedHistory[interfaceName]
  }

  getHistoryBarHeight(entry: HealthHistoryEntry, allEntries: HealthHistoryEntry[]): number {
    const maxLatency = Math.max(...allEntries.map((e) => e.latencyMs), 1)
    return Math.max((entry.latencyMs / maxLatency) * 100, 4)
  }

  getHistoryBarColor(entry: HealthHistoryEntry): string {
    return this.getStatusColor(entry.status)
  }

  formatTime(timestamp: string): string {
    try {
      const date = new Date(timestamp)
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } catch {
      return timestamp
    }
  }
}
