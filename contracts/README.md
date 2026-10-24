# contracts/ — MintExecutor (optional, Across route)

The default one-transaction bridge+mint route uses **Relay** and requires no
deployed contract. `MintExecutor` is only needed if you want to enable the
**Across V3** route for mints that mint to `msg.sender` (no `to` parameter).

```bash
cd contracts
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts
chain=base forge script script/DeployExecutor.s.sol \
  --rpc-url $RPC_BASE --broadcast --private-key $PRIVATE_KEY
```

After deployment:

1. Call `setAuthorized(<SpokePool V3 for this chain>, true)` — use the official
   address from docs.across.to; do not guess.
2. Record the executor address per chain. The Across route (not yet wired in the
   pipeline) will use the message format `abi.encode(target, value, callData)`.
