import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { readFileSync, writeFileSync, existsSync, chmodSync, mkdirSync } from 'node:fs'
import { generateKeyPairSync } from 'node:crypto'
import { join } from 'node:path'
import { config } from '../config.js'

export type WalletType = 'EVM' | 'SOL'

export interface KeystoreWallet {
  id: string
  type: WalletType
  /** EVM: private key hex 0x… · SOL: seed hex tanpa 0x */
  key: string
  address: string
  preferred: boolean
  createdAt: number
}

interface KeystoreFile {
  version: 1
  wallets: KeystoreWallet[]
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function base58(buf: Buffer): string {
  let n = BigInt('0x' + buf.toString('hex'))
  let out = ''
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out
    n /= 58n
  }
  for (const b of buf) {
    if (b === 0) out = '1' + out
    else break
  }
  return out
}

function evmAddress(pk: `0x${string}`): string {
  return privateKeyToAccount(pk).address
}

export class Keystore {
  private file: string
  private data: KeystoreFile

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'keystore.json')
    if (existsSync(this.file)) {
      try {
        const raw = JSON.parse(readFileSync(this.file, 'utf8')) as KeystoreFile
        this.data = { version: 1, wallets: Array.isArray(raw.wallets) ? raw.wallets : [] }
      } catch {
        this.data = { version: 1, wallets: [] }
      }
    } else {
      this.data = { version: 1, wallets: [] }
    }
    // migrasi: PRIVATE_KEY .env → EVM-1 preferred (sekali saja)
    if (this.data.wallets.length === 0 && config.privateKey && /^0x[0-9a-fA-F]{64}$/.test(config.privateKey)) {
      this.data.wallets.push({
        id: 'EVM-1',
        type: 'EVM',
        key: config.privateKey.toLowerCase(),
        address: evmAddress(config.privateKey),
        preferred: true,
        createdAt: Date.now(),
      })
      this.persist()
      console.log('[keystore] PRIVATE_KEY .env dimigrasi → wallet EVM-1 (preferred)')
    }
  }

  private persist(): void {
    writeFileSync(this.file, JSON.stringify(this.data, null, 2), { mode: 0o600 })
    try {
      chmodSync(this.file, 0o600)
    } catch {
      // filesystem without chmod support — leave as-is
    }
  }

  list(): KeystoreWallet[] {
    return this.data.wallets
  }

  evm(): KeystoreWallet[] {
    return this.data.wallets.filter((w) => w.type === 'EVM')
  }

  preferred(): KeystoreWallet | undefined {
    return this.evm().find((w) => w.preferred) ?? this.evm()[0]
  }

  get(id: string): KeystoreWallet | undefined {
    return this.data.wallets.find((w) => w.id === id)
  }

  private nextId(type: WalletType): string {
    const n = this.data.wallets.filter((w) => w.type === type).length + 1
    return `${type}-${n}`
  }

  create(type: WalletType): KeystoreWallet {
    let w: KeystoreWallet
    if (type === 'EVM') {
      const pk = generatePrivateKey()
      w = { id: this.nextId('EVM'), type: 'EVM', key: pk, address: evmAddress(pk), preferred: false, createdAt: Date.now() }
    } else {
      const seed = generateKeyPairSync('ed25519')
      const seedHex = seed.privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(16).toString('hex')
      const pub = seed.publicKey.export({ type: 'spki', format: 'der' }).subarray(12)
      w = { id: this.nextId('SOL'), type: 'SOL', key: seedHex, address: base58(pub), preferred: false, createdAt: Date.now() }
    }
    this.data.wallets.push(w)
    if (!this.data.wallets.some((x) => x.preferred && x.type === 'EVM') && w.type === 'EVM') w.preferred = true
    this.persist()
    return w
  }

  /** Import private key (EVM: 0x-hex 64; SOL: seed hex 64). Throw kalau format salah. */
  importKey(type: WalletType, raw: string): KeystoreWallet {
    const hex = raw.trim().replace(/^0x/, '').toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error('format private key salah (harus 64 hex)')
    if (type === 'EVM') {
      const dup = this.evm().find((w) => w.key === '0x' + hex)
      if (dup) throw new Error(`wallet sudah ada: ${dup.id}`)
      const pk = ('0x' + hex) as `0x${string}`
      const w: KeystoreWallet = { id: this.nextId('EVM'), type: 'EVM', key: pk, address: evmAddress(pk), preferred: false, createdAt: Date.now() }
      this.data.wallets.push(w)
      this.persist()
      return w
    }
    const w: KeystoreWallet = { id: this.nextId('SOL'), type: 'SOL', key: hex, address: base58(Buffer.from(hex, 'hex')), preferred: false, createdAt: Date.now() }
    this.data.wallets.push(w)
    this.persist()
    return w
  }

  exportKey(id: string): { id: string; type: WalletType; address: string; key: string } | null {
    const w = this.get(id)
    if (!w) return null
    return { id: w.id, type: w.type, address: w.address, key: w.key }
  }

  setPreferred(id: string): KeystoreWallet | null {
    const w = this.get(id)
    if (!w || w.type !== 'EVM') return null
    this.data.wallets.forEach((x) => { x.preferred = x.id === id })
    this.persist()
    return w
  }
}

export const keystore = new Keystore(config.dataDir)
