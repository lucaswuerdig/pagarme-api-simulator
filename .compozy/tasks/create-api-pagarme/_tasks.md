# Fake Pagar.me API (Homologation Test Double) — Task List

## Tasks

| # | Title | Status | Complexity | Dependencies |
|---|-------|--------|------------|--------------|
| 01 | Project scaffold & Express bootstrap | pending | medium | — |
| 02 | Pagar.me v5 contract types | pending | low | task_01 |
| 03 | OrderStore interface, in-memory impl & opaque ID util | pending | medium | task_02 |
| 04 | Magic-card outcome resolver | pending | low | task_02 |
| 05 | Response builders (order / charge / token) | pending | medium | task_02, task_03, task_04 |
| 06 | HTTP routes (orders, capture, cancel, tokens, health, reset) | pending | high | task_03, task_04, task_05 |
| 07 | Vercel KV store implementation & store factory | pending | medium | task_03 |
| 08 | Vercel serverless function shim & vercel.json | pending | medium | task_06, task_07 |
| 09 | GitHub Actions CI/CD pipeline | pending | medium | task_08 |
| 10 | Local Docker dev environment (app + Redis) | pending | medium | task_06, task_07 |
| 11 | Connection guide, README & magic-card docs | pending | low | task_08, task_09, task_10 |
