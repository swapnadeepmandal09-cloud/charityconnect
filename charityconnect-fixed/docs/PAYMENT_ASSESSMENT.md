# YouPI-PG assessment (reviewed 2026-10-25)

**Reviewed:** the public GitHub page and README of https://github.com/youpi-pg/YouPI-PG (branch `main`, 169 commits; no commit hash or tag was captured, so **pin one yourself** with `git rev-parse HEAD` after cloning).
**Not reviewed:** `ARCHITECTURE.md`, `openapi.yaml`, `docs/MERCHANT_INTEGRATION.md`, `docs/CONFIGURATION.md`, the LICENSE text (no LICENSE file was visible in the file list although the README refers to one; confirm it exists), and the source code.

| Topic | Finding (from README) |
|---|---|
| Runtime | Node >= 22.13.0 (native `node:sqlite`). Compatible with this project's Node requirement. |
| Shape | 7 separate services (payment API 6100, checkout 7000, admin 6001, demo store 5000, control center 8090, SMS observer 6002, Gmail observer 6003) + Android APK. A standalone gateway, not a library. |
| DB | Own SQLite file `data/youpi_pg.sqlite`, auto-migrated. Independent of CharityConnect. |
| Payment lifecycle | Customer pays any UPI app to the merchant's own VPA; the gateway *infers* success from bank SMS / push notifications / Gmail alerts and then sends a signed webhook. A single-slot FIFO queue is used so amounts can be attributed. |
| Webhook contract | `X-Gateway-Signature: sha256=HMAC(secret, rawBody)`, `X-Gateway-Delivery-Id`, `X-Gateway-Timestamp`, V2 signature binding the timestamp; payload has `orderId`, `amountPaise`, `utr`, `paymentId`. Retries up to 1h with the same body. Reused `orderId` with a different amount -> 409. |
| Risks (README's own words) | Experimental; not certified/audited/NPCI/bank-approved; alert parsing can be wrong, delayed, duplicated or spoofed; amount matching is not identity; suggested max 20 attempts/day/account; reads bank SMS and Gmail, which is sensitive. |
| README inconsistency | README says there is no Dockerfile, but the repo listing shows `Dockerfile` and `docker-compose.yml`. |

## Decision
* CharityConnect ships a `PaymentProvider` interface, a **demo provider (default)** and a **YoupiProvider adapter**.
* **Implemented and tested:** webhook receiver per the README contract (raw-body HMAC, constant-time compare, timestamp freshness window, delivery-id dedupe, order + amount checks, forward-only state machine, transactional update).
* **Not implemented (blocker):** `YoupiProvider.createSession()`. The payment API's REST routes are defined in `openapi.yaml`, which was not reviewed, and endpoints must not be invented. With `PAYMENT_MODE=youpi` donation creation fails safely (donation marked FAILED, user told the provider is not configured).
* **Next steps:** clone YouPI-PG at a pinned commit, read `openapi.yaml` + `MERCHANT_INTEGRATION.md`, implement `createSession`/`getPaymentStatus`, map the real checkout instructions to `paymentInstructions`, set `YOUPI_WEBHOOK_SECRET`, test with a throw-away account.
* **Do not** accept real donations through it without bank/legal review. The V2 timestamp signature is not verified here (only V1 + a freshness check using the timestamp header).
