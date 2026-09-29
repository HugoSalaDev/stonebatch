# T07 Worker performance measurement

Run the reproducible, non-gating Worker-core measurement with:

```sh
npm run benchmark:worker
```

It reports duration, total circles and the Node runtime. It deliberately has no pass/fail time
threshold because CI and virtualized runners are not comparable to a normal browser laptop.

## Recorded run — 29 September 2026

Runtime: Node.js `v24.19.0`, Linux `x64`, AMD EPYC 9V74 80-Core Processor, Vitest.

| Input | Duration | Total circles |
| --- | ---: | ---: |
| 10 rows of `ANNA`, 45 mm, 3.2 mm | 14.713 ms | 3,130 |
| 30 rows of `ANNA`, 45 mm, 3.2 mm | 17.636 ms | 9,390 |

These are warm Worker-core measurements: the local WOFF has already been parsed by the benchmark
fixture, and they exclude browser Worker startup, network cache state and rendering. They confirm
the deterministic calculation workload only; they do **not** prove the product targets of under
3 seconds for 10 names or under 10 seconds for a maximum batch on a typical laptop.

Those two targets remain pending a manual browser measurement on a representative laptop once T08
provides an interactive flow. T06 remains separately pending physical Cricut/material access and
is not evaluated here.
