import { defineChain, type Chain, type Address } from 'viem'
import { rpcOverrides } from './config.js'

export interface ChainConfig {
  key: string
  id: number
  name: string
  rpcs: string[]
  explorer: string
  nativeSymbol: string
  /** coingecko id for USD conversion; when unavailable the USD price renders as "-" */
  coingeckoId: string
  /** slug opensea untuk deep-link, kalau chain-nya ada di OpenSea */
  opensea?: string
  /** network path alchemy, dipakai kalau ALCHEMY_API_KEY diisi */
  alchemy?: string
  /** wrapped native, dipakai beberapa bridge quote */
  weth?: Address
}

const OP_WETH = '0x4200000000000000000000000000000000000006' as Address

export const CHAINS: Record<string, ChainConfig> = {
  ethereum: {
    key: 'ethereum', id: 1, name: 'Ethereum',
    rpcs: ['https://eth.drpc.org', 'https://1rpc.io/eth', 'https://ethereum-rpc.publicnode.com'],
    explorer: 'https://etherscan.io', nativeSymbol: 'ETH', coingeckoId: 'ethereum',
    opensea: 'ethereum', alchemy: 'eth-mainnet',
    weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address,
  },
  base: {
    key: 'base', id: 8453, name: 'Base',
    rpcs: ['https://base.drpc.org', 'https://mainnet.base.org', 'https://base-rpc.publicnode.com'],
    explorer: 'https://basescan.org', nativeSymbol: 'ETH', coingeckoId: 'ethereum',
    opensea: 'base', alchemy: 'base-mainnet', weth: OP_WETH,
  },
  arbitrum: {
    key: 'arbitrum', id: 42161, name: 'Arbitrum One',
    rpcs: ['https://arb1.arbitrum.io/rpc'],
    explorer: 'https://arbiscan.io', nativeSymbol: 'ETH', coingeckoId: 'ethereum',
    opensea: 'arbitrum', alchemy: 'arb-mainnet',
    weth: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' as Address,
  },
  optimism: {
    key: 'optimism', id: 10, name: 'OP Mainnet',
    rpcs: ['https://mainnet.optimism.io'],
    explorer: 'https://optimistic.etherscan.io', nativeSymbol: 'ETH', coingeckoId: 'ethereum',
    opensea: 'optimism', alchemy: 'opt-mainnet', weth: OP_WETH,
  },
  bsc: {
    key: 'bsc', id: 56, name: 'BNB Chain',
    rpcs: ['https://bsc.drpc.org', 'https://bsc-dataseed.binance.org'],
    explorer: 'https://bscscan.com', nativeSymbol: 'BNB', coingeckoId: 'binancecoin',
    opensea: 'bnb', alchemy: 'bnb-mainnet',
    weth: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8' as Address,
  },
  polygon: {
    key: 'polygon', id: 137, name: 'Polygon',
    rpcs: ['https://polygon.drpc.org', 'https://polygon-bor-rpc.publicnode.com'],
    explorer: 'https://polygonscan.com', nativeSymbol: 'POL', coingeckoId: 'matic-network',
    opensea: 'polygon', alchemy: 'polygon-mainnet',
    weth: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619' as Address,
  },
  avalanche: {
    key: 'avalanche', id: 43114, name: 'Avalanche',
    rpcs: ['https://api.avax.network/ext/bc/C/rpc'],
    explorer: 'https://snowtrace.io', nativeSymbol: 'AVAX', coingeckoId: 'avalanche-2',
    opensea: 'avalanche', alchemy: 'avax-mainnet',
    weth: '0xB31f66AA3C1e785363F0875A1B74E27b85FD04c7' as Address,
  },
  blast: {
    key: 'blast', id: 81457, name: 'Blast',
    rpcs: ['https://rpc.blast.io'],
    explorer: 'https://blastscan.io', nativeSymbol: 'ETH', coingeckoId: 'ethereum',
    opensea: 'blast', alchemy: 'blast-mainnet', weth: '0x4300000000000000000000000000000000000003' as Address,
  },
  linea: {
    key: 'linea', id: 59144, name: 'Linea',
    rpcs: ['https://rpc.linea.build'],
    explorer: 'https://linea.etherscan.io', nativeSymbol: 'ETH', coingeckoId: 'ethereum',
    alchemy: 'linea-mainnet',
  },
  scroll: {
    key: 'scroll', id: 534352, name: 'Scroll',
    rpcs: ['https://rpc.scroll.io'],
    explorer: 'https://scrollscan.com', nativeSymbol: 'ETH', coingeckoId: 'ethereum',
    alchemy: 'scroll-mainnet', weth: '0x5300000000000000000000000000000000000004' as Address,
  },
  zksync: {
    key: 'zksync', id: 324, name: 'zkSync Era',
    rpcs: ['https://mainnet.era.zksync.io'],
    explorer: 'https://era.zksync.network', nativeSymbol: 'ETH', coingeckoId: 'ethereum',
    alchemy: 'zksync-mainnet', weth: '0x5AEA5775959FBC2557Cc8782BC2101Bf6a471F03' as Address,
  },
  mantle: {
    key: 'mantle', id: 5000, name: 'Mantle',
    rpcs: ['https://rpc.mantle.xyz'],
    explorer: 'https://mantlescan.xyz', nativeSymbol: 'MNT', coingeckoId: 'mantle',
    alchemy: 'mantle-mainnet',
  },
  zora: {
    key: 'zora', id: 7777777, name: 'Zora',
    rpcs: ['https://rpc.zora.energy'],
    explorer: 'https://zorascan.io', nativeSymbol: 'ETH', coingeckoId: 'ethereum',
    opensea: 'zora', alchemy: 'zora-mainnet', weth: OP_WETH,
  },
  opbnb: {
    key: 'opbnb', id: 204, name: 'opBNB',
    rpcs: ['https://opbnb-mainnet-rpc.bnbchain.org'],
    explorer: 'https://opbnb.bscscan.com', nativeSymbol: 'BNB', coingeckoId: 'binancecoin',
    weth: OP_WETH,
  },
  berachain: {
    key: 'berachain', id: 80094, name: 'Berachain',
    rpcs: ['https://rpc.berachain.com'],
    explorer: 'https://berascan.com', nativeSymbol: 'BERA', coingeckoId: 'berachain',
    weth: '0x6969696969696969696969696969696969696969' as Address,
  },
  unichain: {
    key: 'unichain', id: 130, name: 'Unichain',
    rpcs: ['https://mainnet.unichain.org'],
    explorer: 'https://uniscan.xyz', nativeSymbol: 'ETH', coingeckoId: 'ethereum',
    weth: OP_WETH,
  },
}

export function getChain(key: string): ChainConfig | undefined {
  return CHAINS[key.toLowerCase()]
}

export function getChainById(id: number): ChainConfig | undefined {
  return Object.values(CHAINS).find((c) => c.id === id)
}

/** Urutan RPC: override .env > alchemy > publik */
export function rpcUrls(chain: ChainConfig, alchemyKey?: string): string[] {
  const out: string[] = []
  const override = rpcOverrides[chain.key]
  if (override) out.push(override)
  if (alchemyKey && chain.alchemy) out.push(`https://${chain.alchemy}.g.alchemy.com/v2/${alchemyKey}`)
  out.push(...chain.rpcs)
  return out
}

export function toViemChain(chain: ChainConfig, alchemyKey?: string): Chain {
  return defineChain({
    id: chain.id,
    name: chain.name,
    nativeCurrency: { name: chain.nativeSymbol, symbol: chain.nativeSymbol, decimals: 18 },
    rpcUrls: { default: { http: rpcUrls(chain, alchemyKey) } },
    blockExplorers: { default: { name: 'explorer', url: chain.explorer } },
  })
}
