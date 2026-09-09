# TamKobi MySQL performance report

Generated: `2026-09-08T19:57:43.116667+00:00`

## Host

- CPUs: **4** · load 1/5/15: 0.03 / 0.16 / 0.79
- Memory used: **28.2%** (11769748 kB available)
- Disk `/`: **80.1%** (37.35 GB free)

## MySQL

- Version: `8.0.46` ok=True
- Connections: 6/151 (4.0%) · running 2
- Buffer pool: 128 MB · hit **99.986%**
- Slow query log: `ON` long_query_time=1.000000 · Slow_queries=1
- Documents: **1734** in **56** collections

### Top collections

| collection | rows | KB |
|---|---:|---:|
| `activity_logs` | 676 | 210.6 |
| `roles` | 242 | 168.7 |
| `company_licenses` | 150 | 49.7 |
| `trash` | 95 | 99.2 |
| `units` | 86 | 8.0 |
| `invoices` | 45 | 45.0 |
| `notifications` | 42 | 16.5 |
| `companies` | 40 | 12.9 |
| `users` | 34 | 12.8 |
| `orders` | 32 | 28.4 |
| `stock_movements` | 27 | 8.2 |
| `contacts` | 26 | 15.1 |
| `bank_transactions` | 22 | 9.6 |
| `counters` | 21 | 1.0 |
| `partner_transactions` | 18 | 7.1 |

### Tables

| table | est. rows | data | indexes |
|---|---:|---:|---:|
| `docs` | 1673 | 2637824 | 147456 |
| `meta_indexes` | 7 | 16384 | 0 |
| `system_logs` | 2 | 16384 | 65536 |

## Alerts

- **warning** `disk` — disk / at 80.1%

## Scaling & optimization

1. InnoDB buffer pool is under 256MB; raise innodb_buffer_pool_size toward 50–70% of dedicated MySQL RAM (see mysql/perf.cnf).
2. Filesystem / is 80.1% full; expand disk or purge logs/backups before MySQL cannot extend InnoDB files.

## How this monitor runs

- `python -m perfmon snapshot` — one-shot JSON to stdout
- `python -m perfmon report` — rewrite this markdown
- `backend/scripts/perf-monitor.sh` — cron every minute
- backend `perfmon.loop()` — in-process while the API is up
- Super admin: `GET /api/system/perf`
