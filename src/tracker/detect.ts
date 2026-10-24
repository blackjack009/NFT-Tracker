import { keccak256, stringToHex, type Address } from 'viem'
import type { ChainConfig } from '../chains.js'

export const TRANSFER_TOPIC = keccak256(stringToHex('Transfer(address,address,uint256)'))
const ERC1155_SINGLE_TOPIC = keccak256(stringToHex('TransferSingle(address,address,address,uint256,uint256)'))
const ERC1155_BATCH_TOPIC = keccak256(stringToHex('TransferBatch(address,address,address,uint256[],uint256[])'))
const ZERO_PAD = '0x' + '0'.repeat(64)

export interface RawLog {
  address: string
  topics: string[]
  data: string
  blockNumber: string
  transactionHash: string
  logIndex: string
}

export interface MintEvent {
  chainKey: string
  chainId: number
  token: string
  tokenId: string
  minter: string
  txHash: string
  blockNumber: bigint
  logIndex: number
  standard: 'erc721' | 'erc1155'
  quantity: bigint
}

function topicToAddress(topic: string): string {
  return ('0x' + topic.slice(-40)).toLowerCase()
}

function word(data: string, index: number): bigint {
  const body = data.replace(/^0x/, '')
  const w = body.slice(index * 64, index * 64 + 64)
  return w ? BigInt('0x' + w) : 0n
}

/** Parse raw log jadi MintEvent kalau log-nya adalah mint (transfer dari zero address). */
export function parseMintLog(chain: ChainConfig, log: RawLog): MintEvent | null {
  const topics = log.topics ?? []
  const t0 = topics[0]?.toLowerCase()
  try {
    if (t0 === TRANSFER_TOPIC && topics.length === 4 && topics[1] === ZERO_PAD) {
      return {
        chainKey: chain.key,
        chainId: chain.id,
        token: log.address.toLowerCase(),
        tokenId: BigInt(topics[3]).toString(),
        minter: topicToAddress(topics[2]),
        txHash: log.transactionHash,
        blockNumber: BigInt(log.blockNumber),
        logIndex: Number(BigInt(log.logIndex)),
        standard: 'erc721',
        quantity: 1n,
      }
    }
    if (t0 === ERC1155_SINGLE_TOPIC && topics.length === 4 && topics[2] === ZERO_PAD) {
      return {
        chainKey: chain.key,
        chainId: chain.id,
        token: log.address.toLowerCase(),
        tokenId: word(log.data, 0).toString(),
        minter: topicToAddress(topics[3]),
        txHash: log.transactionHash,
        blockNumber: BigInt(log.blockNumber),
        logIndex: Number(BigInt(log.logIndex)),
        standard: 'erc1155',
        quantity: word(log.data, 1),
      }
    }
    if (t0 === ERC1155_BATCH_TOPIC && topics.length === 4 && topics[2] === ZERO_PAD) {
      const data = log.data.replace(/^0x/, '')
      const idsOffset = Number(word(log.data, 0)) * 2
      const valuesOffset = Number(word(log.data, 1)) * 2
      const idsLen = Number(BigInt('0x' + data.slice(idsOffset, idsOffset + 64)))
      const valuesLen = Number(BigInt('0x' + data.slice(valuesOffset, valuesOffset + 64)))
      const idsStart = idsOffset + 64
      const valuesStart = valuesOffset + 64
      const firstId = idsLen > 0 ? BigInt('0x' + data.slice(idsStart, idsStart + 64)).toString() : '0'
      let total = 0n
      for (let i = 0; i < valuesLen; i++) {
        total += BigInt('0x' + data.slice(valuesStart + i * 64, valuesStart + i * 64 + 64))
      }
      return {
        chainKey: chain.key,
        chainId: chain.id,
        token: log.address.toLowerCase(),
        tokenId: firstId,
        minter: topicToAddress(topics[3]),
        txHash: log.transactionHash,
        blockNumber: BigInt(log.blockNumber),
        logIndex: Number(BigInt(log.logIndex)),
        standard: 'erc1155',
        quantity: total,
      }
    }
  } catch {
    return null
  }
  return null
}

export const getLogsTopics = {
  erc721Mints: [TRANSFER_TOPIC, ZERO_PAD],
  erc1155Mints: [ERC1155_SINGLE_TOPIC, ERC1155_BATCH_TOPIC].map((sig) => [sig, null, ZERO_PAD]),
} as const

export type { Address }
