import { formatEther } from 'viem'

export function shortAddr(addr: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function fmtEth(wei: bigint): string {
  const n = Number(formatEther(wei))
  return n.toLocaleString('en-US', { maximumFractionDigits: 6 })
}

export function fmtUsd(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
}

export function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '')
}
