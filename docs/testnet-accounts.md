# Testnet accounts

Written by `pnpm bootstrap` (`scripts/bootstrap.ts`) on Hedera testnet. IDs and HashScan
links only: every private key stays in the shared env file (`../kosha.env`).

| Role                                             | Env key                        | ID                                                               |
| ------------------------------------------------ | ------------------------------ | ---------------------------------------------------------------- |
| Core: operator, fee payer, tUSDC treasury        | `CORE_ACCOUNT_ID`              | [0.0.11341449](https://hashscan.io/testnet/account/0.0.11341449) |
| Settlement token                                 | `SETTLEMENT_TOKEN_ID`          | [0.0.11342837](https://hashscan.io/testnet/token/0.0.11342837)   |
| Compliance                                       | `COMPLIANCE_ACCOUNT_ID`        | [0.0.11342838](https://hashscan.io/testnet/account/0.0.11342838) |
| receiver-in (Indian API owner)                   | `RECEIVER_IN_ACCOUNT_ID`       | [0.0.11342839](https://hashscan.io/testnet/account/0.0.11342839) |
| receiver-in-solo                                 | `RECEIVER_IN_SOLO_ACCOUNT_ID`  | [0.0.11342840](https://hashscan.io/testnet/account/0.0.11342840) |
| receiver-global (foreign API)                    | `RECEIVER_GLOBAL_ACCOUNT_ID`   | [0.0.11342841](https://hashscan.io/testnet/account/0.0.11342841) |
| agent-resident                                   | `AGENT_RESIDENT_ACCOUNT_ID`    | [0.0.11342842](https://hashscan.io/testnet/account/0.0.11342842) |
| agent-resident reserve (2-of-2: agent + Core)    | `AGENT_RESIDENT_RESERVE_ID`    | [0.0.11342843](https://hashscan.io/testnet/account/0.0.11342843) |
| agent-nonresident                                | `AGENT_NONRESIDENT_ACCOUNT_ID` | [0.0.11342844](https://hashscan.io/testnet/account/0.0.11342844) |
| agent-nonresident reserve (2-of-2: agent + Core) | `AGENT_NONRESIDENT_RESERVE_ID` | [0.0.11342847](https://hashscan.io/testnet/account/0.0.11342847) |
| agent-unknown                                    | `AGENT_UNKNOWN_ACCOUNT_ID`     | [0.0.11342848](https://hashscan.io/testnet/account/0.0.11342848) |
| agent-unknown reserve (2-of-2: agent + Core)     | `AGENT_UNKNOWN_RESERVE_ID`     | [0.0.11342849](https://hashscan.io/testnet/account/0.0.11342849) |
| compat-settlement (Core key)                     | `COMPAT_SETTLEMENT_ACCOUNT_ID` | [0.0.11342850](https://hashscan.io/testnet/account/0.0.11342850) |
| pool-reserve (2-of-2: Core + compliance)         | `POOL_RESERVE_ACCOUNT_ID`      | [0.0.11342851](https://hashscan.io/testnet/account/0.0.11342851) |
| audit (submit key of the audit topic)            | `AUDIT_ACCOUNT_ID`             | [0.0.11347271](https://hashscan.io/testnet/account/0.0.11347271) |
| HCS payments topic                               | `HCS_PAYMENTS_TOPIC`           | [0.0.11342856](https://hashscan.io/testnet/topic/0.0.11342856)   |
| HCS profiles topic                               | `HCS_PROFILES_TOPIC`           | [0.0.11342857](https://hashscan.io/testnet/topic/0.0.11342857)   |
| HCS audit topic                                  | `HCS_AUDIT_TOPIC`              | [0.0.11347272](https://hashscan.io/testnet/topic/0.0.11347272)   |

## HCS-14 identities (B23)

Written by `pnpm register-agents`: each Level 1 demo agent's UAID (`AGENT_*_UAID`) and the HCS-1
topic holding its HCS-11 profile (`AGENT_*_PROFILE_TOPIC`), pointed at by the account's memo.

| Agent             | UAID                                                                                                                                                 | Profile topic                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| agent-resident    | `uaid:aid:2LPMHxA1PrnwmzQWUzAGdQFXDzszoQgjnqj4f6p4jiGGCz9GCjNmm3778nsUMUMaCT;uid=0;registry=kosha;proto=hcs-10;nativeId=hedera:testnet:0.0.11342842` | [0.0.11345911](https://hashscan.io/testnet/topic/0.0.11345911) |
| agent-nonresident | `uaid:aid:7vfERcmgQbHwANbmAMXGFchQARo5xD8pdzkq443nqEaXSunaiAnPVNNiWmYtDGGM31;uid=0;registry=kosha;proto=hcs-10;nativeId=hedera:testnet:0.0.11342844` | [0.0.11345913](https://hashscan.io/testnet/topic/0.0.11345913) |
