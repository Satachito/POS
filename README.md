# POS

Order-taking and settlement for one restaurant: 40 seats over 16 tables, three Android
handies, one kitchen display, one Raspberry Pi in the back.

Storage is [JSONables](../JSONables) — every record is one line of JSON in `data/pos/`.

```
       [業務用AP] ──(Wi-Fi)── [Android ハンディ x3 (+予備1)]
            │                  Room に送信キュー / メニューキャッシュ
         (有線LAN)
            │
    ┌───────┴────────┐
    │ Raspberry Pi 5  │  node server/main.js  (systemd, Restart=always)
    │ NVMe SSD / UPS  │  data/pos/*.jsons  ← 全部テキスト
    └───────┬────────┘
            └──(HDMI)── KDS  Chromium kiosk → localhost/apps/kds/

    [予備ラズパイ] ← rsync data/pos するだけ。差し替え5分
```

## Running

```
npm start                                  # http://localhost:8080/apps/kds/
POS_TOKEN=xxxx ADMIN_TOKEN=yyyy npm start  # what the Pi actually runs
```

`deploy/pos.service` is the systemd unit; `deploy/close.sh` is the close-of-business ritual.

## Why JSONables and not SQLite

Three properties of this store matter more than query power, and it has all three:

- **Every write is `fsync`ed.** `AppendLog` in `jsonables/cluster.js` calls `writeSync` +
  `fsyncSync` per record. An order that got a `2xx` is on the disk platter. A restaurant Pi
  loses power without warning, and a few writes a minute makes the cost invisible.
- **Append-only matches what orders are.** Kitchen tickets are events, not rows to update.
  `tail -f data/pos/tickets.log.jsons` shows the floor in real time, in plain text.
- **Text means git is the backup.** No Litestream, no dump/restore. `git commit data/pos`
  at close, and "roll back to 18:00" is a checkout.

What it does not have — joins, transactions, schema — the design avoids rather than
emulates: records nest instead of being normalised, and one ticket is one write.

## Data model

```
data/pos/
  tables.jsons       16 tables / 40 seats   keyFields: ["code"]      master, in git
  categories.jsons                          keyFields: ["code"]      master, in git
  items.jsons        menu, prices, options  keyFields: ["code"]      master, in git
  orders.jsons       伝票 = one settlement   keyFields: ["order_id"]  mutable
  tickets.jsons      キッチン伝票            keyFields: ["ticket_id"] content immutable
```

An **order** is a table from seating to settlement. A **ticket** is one send to the kitchen;
its lines never change after they are written, only their served/void state does. Everything
totals up from the tickets, so a bill can always be re-derived from what the kitchen actually
got.

**Cross-cluster references are logical keys, never internal ids.** `tools/compact.js` rewrites
each base file, and JSONables re-derives internal ids when it does — a record POSTed as
`id-<uuid>` reloads as `base-7`. Anything that stored one would dangle after the first close
of business. `server/keyed.js` is the only file that touches ids at all.

An order does not store its own list of tickets either. That index is rebuilt from the
clusters at boot (`BuildIndex` in `server/routes-pos.js`), so it cannot disagree with the
disk — a crash between two writes can't leave a ticket off a bill.

## API

Everything under `/pos/`. Localhost is always allowed, which is how the KDS runs
token-free on the Pi; anything else needs `X-POS-Token` (or `?token=` on the SSE stream,
because `EventSource` cannot set headers).

| | |
|---|---|
| `GET /pos/menu?v=hash` | menu snapshot; `v` is a content hash, so an unchanged menu costs 40 bytes |
| `GET /pos/tables` | all 16 tables with their open order and running total |
| `POST /pos/order` | open a table — idempotent on `order_id` |
| `GET /pos/order/{order_id}` | order, tickets, running bill |
| `POST /pos/order/{order_id}/close` | settle — an order closes once, and that is its idempotency |
| `POST /pos/ticket` | send to the kitchen — idempotent on `ticket_id` |
| `POST /pos/ticket/{id}/void` | cancel one line, with reason and terminal recorded |
| `GET /pos/kds?station=` | what the kitchen still owes |
| `POST /pos/kds/{id}` | advance a line, a station, or the whole ticket |
| `GET /pos/sales/{YYYY-MM-DD}` | day total, tax by rate, takings by method |
| `GET /pos/events` | SSE: `ticket` / `kds` / `order` |
| `GET /pos/health` | counts, for the monitor |

`/db/pos/...` is JSONables' generic CRUD — the menu-editing surface. It is unauthenticated by
design upstream, so `server/main.js` keeps it on the Pi itself unless `ADMIN_TOKEN` is set.

### Two rules the handy lives by

**The terminal generates the id.** `order_id`, `ticket_id` — UUIDs from the device. A handy
that sends an order and loses the response in the walk-in's Wi-Fi shadow repeats the request
verbatim and gets the first result back. Without this, `POST` retries put the same order
through the pass twice, and it happens on a real floor within the first week.

**The terminal is never trusted with money.** It sends item codes, quantities and option
codes. Names, prices, tax rates, option surcharges and every total are resolved here from
`items.jsons`. A stale menu cache on a handy cannot move a yen.

### Tax

Menu prices are tax-inclusive, as printed. The tax component is reported per rate and
computed once on that rate's subtotal — not summed per line — which is what a qualified
invoice requires. A discount is apportioned across rates in proportion to their subtotals,
so a bill mixing 8% and 10% stays reportable.

## Close of business

```bash
sudo systemctl stop pos && node tools/compact.js && git add data/pos && git commit -m "close $(date +%F)" && sudo systemctl start pos
```

or just `deploy/close.sh`.

Compaction folds each write log back into its base file. Without it, `load()` replays a year
of appends before the first table can be opened in the morning. It refuses to run while the
server is up: a write landing between the read and the truncate would be lost, and that write
is somebody's order.

## For the Android side

- Cache the menu locally; check `/pos/menu?v=` on launch and re-check periodically.
- Persist orders in Room **before** sending. Pressing 送信 saves and advances the screen
  immediately; the network is a background concern. Show `未送信 N件` in the corner.
- Never drop a queued ticket until a `2xx` comes back. Retry the identical body forever —
  that is what the idempotency keys are for.
- Screen-pin the app (Device Owner if the fleet allows) so nobody wanders to the home screen.
- Read table numbers from NFC tags or QR on the tables rather than typing them.

## Not built yet

- **Menu admin UI.** Edit `data/pos/items.jsons` directly (it is designed to be read by a
  human) or drive `/db/pos/items/` from a page like JSONables' own `apps/sql`.
- **Receipt printing.** The bill is computed and stored; nothing renders it to an ESC/POS
  printer yet.
- **Table moves and bill splitting.** `order.table` is fixed at open, and one order settles
  as one bill.
- **Yearly rotation.** Every record stays in memory. At ~300 tickets a day that is fine for
  years, but `tickets.jsons` should eventually roll to `tickets-2026.jsons` at year end.
