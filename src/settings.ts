import { db } from './db.js'
import { config } from './config.js'

export type GasMode = 'auto' | 'preset' | 'custom'
export type GasPreset = 'std' | 'fast' | 'inst'

export interface Settings {
  autoMint: boolean
  maxPriceEth: number
  maxQty: number
  reviewTimeoutSec: number
  gasMode: GasMode
  gasPreset: GasPreset
  /** plafon gwei (auto) atau nilai manual (custom/preset) */
  gwei: number
  /** priority fee gwei */
  prioGwei: number
  /** batas gap bridge % — quote ditolak kalau lebih */
  gapPct: number
  /** budget spend per 24 jam (ETH-equivalent native) */
  budgetEth: number
  confirmSend: boolean
}

export const GAS_PRESETS: Record<GasPreset, { gwei: number; prioGwei: number; label: string }> = {
  std: { gwei: 2, prioGwei: 0.5, label: '🐢 Standar' },
  fast: { gwei: 5, prioGwei: 1, label: '🚗 Cepat' },
  inst: { gwei: 10, prioGwei: 2, label: '🚀 Instan' },
}

export const PRICE_STEPS = [0.1, 0.25, 0.5, 1]
export const QTY_STEPS = [1, 3, 5, 10]
export const TIMEOUT_STEPS = [60, 120, 180]
export const GAP_STEPS = [0.5, 1.0, 1.5, 2.0]
export const BUDGET_STEPS = [0.5, 1, 2, 5]

function defaults(): Settings {
  return {
    autoMint: db.getSetting('auto_mode', '0') === '1',
    maxPriceEth: config.maxMintPriceEth,
    maxQty: 5,
    reviewTimeoutSec: Math.round(config.confirmTimeoutMs / 1000),
    gasMode: 'auto',
    gasPreset: 'fast',
    gwei: GAS_PRESETS.fast.gwei,
    prioGwei: GAS_PRESETS.fast.prioGwei,
    gapPct: config.maxBridgeGapPct,
    budgetEth: 1,
    confirmSend: true,
  }
}

function load(): Settings {
  const raw = db.getSetting('settings', '')
  const base = defaults()
  if (!raw) return base
  try {
    return { ...base, ...(JSON.parse(raw) as Partial<Settings>) }
  } catch {
    return base
  }
}

/** Setting runtime — bisa diubah dari chat (edit-in-place) dan langsung kepakai tx berikutnya. */
export const settings: Settings = load()

export function saveSettings(): void {
  db.setSetting('settings', JSON.stringify(settings))
  db.setSetting('auto_mode', settings.autoMint ? '1' : '0')
}

export function updateSettings(patch: Partial<Settings>): Settings {
  Object.assign(settings, patch)
  saveSettings()
  return settings
}

export function applyPreset(p: GasPreset): void {
  const preset = GAS_PRESETS[p]
  updateSettings({ gasMode: 'preset', gasPreset: p, gwei: preset.gwei, prioGwei: preset.prioGwei })
}

/** Stepper gwei manual — begitu dipakai, mode jadi custom. */
export function gweiStep(dir: '+' | '-'): void {
  const gwei = Math.max(0.5, Math.min(50, +(settings.gwei + (dir === '+' ? 0.5 : -0.5)).toFixed(1)))
  updateSettings({ gwei, gasMode: 'custom' })
}

export function prioStep(dir: '+' | '-'): void {
  const prioGwei = Math.max(0.1, Math.min(5, +(settings.prioGwei + (dir === '+' ? 0.1 : -0.1)).toFixed(1)))
  updateSettings({ prioGwei })
}
