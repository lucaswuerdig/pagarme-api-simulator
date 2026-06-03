# Fake Pagar.me API (Homologation Test Double) — Task List

## Tasks

| # | Title | Status | Complexity | Dependencies |
|---|-------|--------|------------|--------------|
| 01 | Project scaffold & Express bootstrap | completed | medium | — |
| 02 | Pagar.me v5 contract types | completed | low | task_01 |
| 03 | OrderStore interface, in-memory impl & opaque ID util | completed | medium | task_02 |
| 04 | Magic-card outcome resolver | completed | low | task_02 |
| 05 | Response builders (order / charge / token) | completed | medium | task_02, task_03, task_04 |
| 06 | HTTP routes (orders, capture, cancel, tokens, health, reset) | completed | high | task_03, task_04, task_05 |
| 07 | Vercel KV store implementation & store factory | completed | medium | task_03 |
| 08 | Vercel serverless function shim & vercel.json | completed | medium | task_06, task_07 |
| 09 | GitHub Actions CI/CD pipeline | completed | medium | task_08 |
| 10 | Local Docker dev environment (app + Redis) | completed | medium | task_06, task_07 |
| 11 | Connection guide, README & magic-card docs | completed | low | task_08, task_09, task_10 |
