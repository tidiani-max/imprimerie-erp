# QA report — Imprimerie ERP

- Date: 2026-10-07T10:03:06.767Z
- Machine: Linux 6.18.44-fc-v77 x64, 1 × Intel(R) Xeon(R) Processor @ 2.80GHz, 3.9 GB RAM
- Node v22.22.2, database: pglite
- Settings: 100,000 orders, 12 devices on one account, 20 parallel users × 15s

## 1. Accuracy — many devices, one account, same time
  PASS  owner account created  (status 201)
  PASS  12 devices logged in with the SAME account
  600 orders sent in parallel from 12 devices: 600 accepted in 8.4s
  PASS  every order accepted  (600/600)
  PASS  no duplicate order numbers
  PASS  stock decreased exactly once per order  (stock 4400, expected 4400)
  PASS  simultaneous payments on one order end in a valid state
  PASS  overselling impossible: exactly 10 of 50 orders accepted  (accepted 10, refused 40)
  PASS  stock never negative  (stock 0)
  PASS  cash register: every running balance = previous balance ± amount (no gaps, no double counting)  (0 broken rows)
  PASS  cash register: last balance = total in − total out  (6225 vs 6225)
  PASS  money collected on orders = cash entries for orders  (6600 vs 6600)
  PASS  every client total = sum of that client's orders  (0 clients off)
  PASS  every order status matches its payments  (0 mismatches)
  PASS  a different device sees the data entered by the others

## 2. Speed — 100,000 orders in the database
  loaded 100,000 orders, 5,000 clients, 10,000 expenses, 10,000 cash entries in 10s

  FAST  Dashboard                                    median   142 ms   p95   186 ms
  FAST  Orders — first page (200)                    median    31 ms   p95    48 ms
  FAST  Orders — page in the middle of the data      median   117 ms   p95   141 ms
  FAST  Orders — filter "Impayé"                     median    48 ms   p95    69 ms
  FAST  Orders — this month                          median    27 ms   p95    32 ms
  FAST  Orders — search by text                      median    38 ms   p95    56 ms
  FAST  Orders — search by order number              median    44 ms   p95    55 ms
  OK    Clients — full list                          median   478 ms   p95   482 ms
  FAST  Clients — search                             median   106 ms   p95   130 ms
  FAST  Client — debt detail                         median     7 ms   p95    22 ms
  FAST  Stock — list                                 median    11 ms   p95    21 ms
  FAST  Cash — list + balance                        median    19 ms   p95    29 ms
  FAST  Expenses — list                              median    40 ms   p95    56 ms
  FAST  Create an order (full transaction)           median    15 ms   p95    21 ms
  FAST  Record a payment on an order                 median    13 ms   p95    20 ms

  Mixed load: 20 people working at once for 15s (70% reading, 30% writing)
  260 requests, 17 per second, errors 0
  response time: median 1068 ms, p95 3126 ms, p99 5371 ms  (reads p95 2208 ms, writes p95 4401 ms)
  PASS  no request failed under mixed load  (0 errors)

## 3. Accuracy re-check after the heavy load
  PASS  cash register chain still exact  (0 broken rows)
  PASS  every client total still equals the sum of their orders  (0 clients off)
  PASS  order numbers still unique
  database size on disk: 56 MB; memory used by this test: 537 MB

## Verdict
- Accuracy: ALL CHECKS PASSED
- Speed: every screen answers within limits
- Total test time: 62s
- Thresholds: FAST ≤ 300 ms, OK ≤ 1500 ms, SLOW above (95th percentile).
