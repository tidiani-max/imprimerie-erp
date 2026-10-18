# QA report — Imprimerie ERP

- Date: 2026-10-07T09:58:37.472Z
- Machine: Linux 6.18.44-fc-v77 x64, 1 × Intel(R) Xeon(R) Processor @ 2.80GHz, 3.9 GB RAM
- Node v22.22.2, database: pglite
- Settings: 1,000,000 orders, 12 devices on one account, 20 parallel users × 20s

## 1. Accuracy — many devices, one account, same time
  PASS  owner account created  (status 201)
  PASS  12 devices logged in with the SAME account
  600 orders sent in parallel from 12 devices: 600 accepted in 10.4s
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

## 2. Speed — 1,000,000 orders in the database
  loaded 1,000,000 orders, 50,000 clients, 100,000 expenses, 100,000 cash entries in 95s

  SLOW  Dashboard                                    median  1198 ms   p95  1575 ms
  FAST  Orders — first page (200)                    median   166 ms   p95   218 ms
  SLOW  Orders — page in the middle of the data      median  1366 ms   p95  1595 ms
  OK    Orders — filter "Impayé"                     median   321 ms   p95   407 ms
  FAST  Orders — this month                          median    34 ms   p95    40 ms
  FAST  Orders — search by text                      median    49 ms   p95    76 ms
  FAST  Orders — search by order number              median    58 ms   p95    61 ms
  SLOW  Clients — full list                          median  5706 ms   p95  6378 ms
  OK    Clients — search                             median   903 ms   p95  1019 ms
  FAST  Client — debt detail                         median     9 ms   p95    24 ms
  FAST  Stock — list                                 median    13 ms   p95    20 ms
  FAST  Cash — list + balance                        median    71 ms   p95   108 ms
  FAST  Expenses — list                              median   225 ms   p95   265 ms
  FAST  Create an order (full transaction)           median    12 ms   p95    16 ms
  FAST  Record a payment on an order                 median    10 ms   p95    16 ms

  Mixed load: 20 people working at once for 20s (70% reading, 30% writing)
  67 requests, 3 per second, errors 0
  response time: median 3857 ms, p95 22728 ms, p99 22776 ms  (reads p95 17944 ms, writes p95 22776 ms)
  PASS  no request failed under mixed load  (0 errors)

## 3. Accuracy re-check after the heavy load
  PASS  cash register chain still exact  (0 broken rows)
  PASS  every client total still equals the sum of their orders  (0 clients off)
  PASS  order numbers still unique
  database size on disk: 399 MB; memory used by this test: 764 MB

## Verdict
- Accuracy: ALL CHECKS PASSED
- Speed: 3 screen(s) too slow: Dashboard; Orders — page in the middle of the data; Clients — full list
- Total test time: 251s
- Thresholds: FAST ≤ 300 ms, OK ≤ 1500 ms, SLOW above (95th percentile).
