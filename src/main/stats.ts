import si from 'systeminformation';
import type { SystemStats } from '../shared/types';

/**
 * Collects CPU / GPU / RAM / network stats via the cross-platform
 * `systeminformation` package. GPU temp/load availability varies by
 * vendor and OS; fields are optional and simply omitted when unknown.
 */
export class StatsCollector {
  // Hardware model strings rarely change at runtime, so we resolve them once
  // (the systeminformation calls behind them are slow — multi-hundred ms on
  // Windows) and reuse the cached values forever after.
  private cpuName: string | null = null;
  private gpuName: string | null = null;
  private namesResolved = false;

  private async resolveNames(): Promise<void> {
    if (this.namesResolved) return;
    this.namesResolved = true;
    try {
      const cpu = await si.cpu();
      this.cpuName = [cpu.manufacturer, cpu.brand].filter(Boolean).join(' ').trim() || null;
    } catch {
      /* leave null */
    }
    try {
      const gfx = await si.graphics();
      const primary =
        gfx.controllers.find((c) => typeof c.utilizationGpu === 'number') ?? gfx.controllers[0];
      this.gpuName = primary?.model ?? null;
    } catch {
      /* leave null */
    }
  }

  async collect(): Promise<SystemStats> {
    // Kick off the (cached) name resolution on the first collect. After the
    // first call this is effectively free.
    void this.resolveNames();

    const [load, mem, temp, gfx, net] = await Promise.all([
      si.currentLoad().catch(() => null),
      si.mem().catch(() => null),
      si.cpuTemperature().catch(() => null),
      si.graphics().catch(() => null),
      si.networkStats().catch(() => null),
    ]);

    const stats: SystemStats = {
      cpuLoad: load ? Math.round(load.currentLoad) : 0,
      ramUsed: mem ? +(mem.active / 1024 ** 3).toFixed(1) : 0,
      ramTotal: mem ? +(mem.total / 1024 ** 3).toFixed(1) : 0,
    };

    if (temp && typeof temp.main === 'number' && temp.main > 0) {
      stats.cpuTemp = Math.round(temp.main);
    }

    // Pick the first GPU controller that reports utilization.
    if (gfx && gfx.controllers && gfx.controllers.length > 0) {
      const gpu = gfx.controllers.find((c) => typeof c.utilizationGpu === 'number');
      if (gpu) {
        if (typeof gpu.utilizationGpu === 'number') stats.gpuLoad = Math.round(gpu.utilizationGpu);
        if (typeof gpu.temperatureGpu === 'number' && gpu.temperatureGpu > 0)
          stats.gpuTemp = Math.round(gpu.temperatureGpu);
        if (typeof gpu.vram === 'number' && gpu.vram > 0) {
          // systeminformation reports vram in MB.
          stats.vramTotal = +(gpu.vram / 1024).toFixed(1);
        }
      }
    }

    if (this.cpuName) stats.cpuName = this.cpuName;
    if (this.gpuName) stats.gpuName = this.gpuName;

    // Network throughput in Mbps from the primary interface.
    if (net && net.length > 0) {
      const primary = net[0];
      if (primary) {
        stats.netDownMbps = +(((primary.rx_sec || 0) * 8) / 1e6).toFixed(1);
        stats.netUpMbps = +(((primary.tx_sec || 0) * 8) / 1e6).toFixed(1);
      }
    }

    return stats;
  }
}
