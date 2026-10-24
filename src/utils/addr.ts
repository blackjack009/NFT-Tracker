/**
 * Heuristic snipers: kalau calldata mint mengandung address si wallet yang kita
 * tiru (biasanya param `to`/`recipient` di fungsi mint), ganti jadi address kita
 * supaya NFT-nya nyasar ke wallet bot, bukan ke wallet aslinya.
 * Scan per 32-byte word after the 4-byte selector (unaligned dynamic args are
 * skipped — sufficient for the common mint(address,uint256) cases).
 */
const ZERO_WORD = '0'.repeat(24)

function addrWord(addr: string): string {
  return ZERO_WORD + addr.toLowerCase().replace(/^0x/, '')
}

export function swapAddressInCalldata(
  data: string,
  from: string,
  to: string,
): { data: string; replaced: number } {
  if (!/^0x[0-9a-fA-F]*$/.test(data) || data.length < 10) return { data, replaced: 0 }
  const selector = data.slice(0, 10)
  const body = data.slice(10)
  const fromWord = addrWord(from)
  const toWord = addrWord(to)
  let out = selector
  let replaced = 0
  for (let i = 0; i < body.length; i += 64) {
    const word = body.slice(i, i + 64)
    if (word.length < 64) {
      out += word
      break
    }
    if (word === fromWord) {
      out += toWord
      replaced++
    } else {
      out += word
    }
  }
  return { data: out, replaced }
}
