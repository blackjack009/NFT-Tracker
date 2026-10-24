# NFT Tracker

Telegram bot that monitors a curated list of wallets (a "cluster") across EVM chains,
detects NFT mints in near real time, and lets you review and execute copy-mints —
including a **single-transaction bridge + mint** via [Relay](https://relay.link) when
funds are held on a different chain. The entire UX is chat-native: menus, settings,
wallet management, and live execution status are rendered as messages that are edited
in place — no web app required.

> Status: **beta, EVM-only.** Solana support is on the roadmap.

## Features

- **Real-time mint detection** — `eth_getLogs` polling for ERC-721/ERC-1155 mints
  (transfers from the zero address) on 16 EVM chains, with optional Alchemy address
  activity webhooks for lower latency.
- **Cluster intelligence** — alerts include every tracked wallet that minted the same
  collection within the last 15 minutes, with per-wallet counts.
- **Review-first execution** — the bot never mints without explicit confirmation.
  The review card lets you set quantity and route (Auto / Direct / 1-TX Relay /
  2-TX Safe) before signing off.
- **One-transaction bridge + mint** — for cross-chain funds, the destination mint
  call is embedded in the Relay quote, so a single deposit transaction covers both
  the bridge and the mint. Falls back to a two-step flow when the mint calldata
  cannot be carried across.
- **Multi-wallet keystore** — create (EVM & Solana), import, export, and designate a
  preferred wallet. Keys are stored locally in `data/keystore.json` (mode 0600) and
  never leave the machine except through a manual export.
- **Runtime settings from chat** — gas mode (RPC-following with ceiling, presets, or
  custom gwei), price cap, max quantity, review timeout, bridge gap guard, and a
  24-hour budget cap. Changes apply to the next transaction immediately.
- **Risk guards** — simulated execution before broadcast (`eth_call`), per-NFT price
  cap, bridge quote rejection when the price gap exceeds the configured threshold,
  and a daily spend limit.
- **Live status board** — the alert message is edited in place into a step-by-step
  checklist (quote → deposit → relayer → mint → done) with an elapsed timer, ending
  with OpenSea and explorer links.

## How it works

```
wallets.json (tracked cluster)
        │
        ▼
  [poller: eth_getLogs]      ERC-721/1155 Transfer from 0x0 to a tracked wallet
        │
        ▼
  [alert: collection, price, cluster list, links]
        │            🧾 Review (quantity & route, edited in place)
        ▼
  [live status board]        same message, updated per stage
        │
        ├── same chain ──────► direct mint (1 tx)
        └── other chain ─────► Relay 1-TX bridge+mint ──► fallback: 2-TX bridge → mint
        ▼
  [result: token IDs, tx/OpenSea/inventory links]
```

## Telegram commands

| Command   | Purpose                                                        |
|-----------|----------------------------------------------------------------|
| `/start`  | Main menu: status, statistics, balances (edited in place)      |
| `/settings` | Mint settings, gas & gwei (presets + custom), security       |
| `/wallets`  | Create / import / export wallets, switch preferred wallet    |
| `/rate`     | Live bridge quote: send/receive amounts, gap, fees          |
| `/jobs`     | Recent job history                                           |

## Project structure

| Path                    | Responsibility                                            |
|-------------------------|-----------------------------------------------------------|
| `src/tracker/`          | Multi-chain log poller, mint parser, Alchemy webhook input |
| `src/executor/`         | Direct mint, funding source selection, Relay 1-TX & 2-TX   |
| `src/notifier/`         | Telegram send/edit layer, interaction controller, views    |
| `src/wallets/keystore.ts` | Multi-wallet keystore (EVM + Solana), local file (0600)  |
| `src/settings.ts`       | DB-backed runtime settings edited live from chat           |
| `src/orchestrator.ts`   | Detection → cluster aggregation → job creation → alert     |
| `src/chains.ts`         | Registry of 16 EVM chains (RPCs, explorers, OpenSea slugs) |
| `contracts/`            | Optional `MintExecutor.sol` for an Across V3 route (Foundry) |

## Setup

```bash
npm install
cp .env.example .env                # set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID
cp wallets.example.json wallets.json  # add the wallet addresses to track
npm run simulate                    # end-to-end demo, no keys or funds required
npm start                           # live
```

### Wallets

`PRIVATE_KEY` in `.env` is used once to seed the keystore on first start. After that,
manage wallets via `/start → Wallet`:

- **Create** — fresh EVM or Solana keypair generated locally
- **Import** — send `pk[,label]` in chat; the message containing the key is deleted
  automatically after import
- **Export** — reveal a private key once, with a confirmation step
- **Preferred** — the default funding wallet; if its balance is insufficient, the bot
  scans every wallet × enabled chain for the best funded source

Use a dedicated burner wallet with limited funds.

## Configuration

| Variable               | Meaning                                                                |
|------------------------|------------------------------------------------------------------------|
| `TELEGRAM_BOT_TOKEN`   | Bot token from @BotFather                                              |
| `TELEGRAM_CHAT_ID`     | Chat that receives alerts and controls                                 |
| `CHAINS_ENABLED`       | Comma-separated chain keys (see `src/chains.ts`)                       |
| `RPC_<CHAIN>`          | Optional per-chain RPC override                                        |
| `POLL_INTERVAL_MS`     | Polling interval per chain (default 6000)                              |
| `MAX_MINT_PRICE_ETH`   | Hard cap per NFT (also editable in `/settings`)                        |
| `MAX_BRIDGE_GAP_PCT`   | Bridge quote rejected when the price gap exceeds this (default 1.5%)   |
| `ALCHEMY_API_KEY`      | Optional; more reliable RPCs for supported chains                      |
| `OPENSEA_API_KEY`      | Optional; collection metadata fallback                                 |
| `WEBHOOK_PORT`         | Optional; enables the Alchemy address-activity webhook receiver        |

Runtime equivalents of the caps above (gas mode, quantity, timeout, gap, budget) can
be changed from `/settings` and persist in the database.

## Limitations

- Allowlisted mints with per-address signatures cannot be copied — the signature is
  not valid for the bot's wallet. Detection and alerting still work.
- Mint prices are read from the transaction's native value; ERC-20 priced mints are
  not supported yet.
- Detection is block-based (~6 s). Mempool-level sniping is on the roadmap.

## Roadmap

- Mempool listener for pre-block alerts
- Additional bridge routes (deBridge, Across SDK)
- Solana execution
- Multi-network webhooks with auto-registration

## License

See [LICENSE](LICENSE).
