# V2-R4 independent review — REVISE

Human status: `not_run`; participants: 0. Product code was not edited by the evaluator. Frozen candidate game SHA256: `ed695d8050e906158b6a3fecc4cbd8e31c8215023758b672a3c2f4fc189cf616`. Manifest and live candidate matched at review.

## Blocking finding V2-R4-F01 (P2)

At 600×320, forecast and trip/recovery overlays obscure the facility information used to understand the new demand event. Forecast covers the house name. The trip panel covers `주택 · 수요 ↑` and part of the still-lit park reading; recovery hint text intersects the house `0V, 0A` reading. Confirmed by actual rendered DOM ranges after 1 second settling and a browser screenshot.

Reproduction: seed101; house on A; advance12; remove inherited lamp2–lamp3 series wire and reconnect those two loads in parallel on B; advance12; pump on A. Advance9 for the 3-second preview; advance9.1 for the tripped state. Use viewport600×320.

Key bounds: risk panel x166–434,y76–129.6; house demand marker x224.6–261.4,y103–111.8. Hint title x232.8–367.2,y136–152.8; house reading x224.7–261.6,y148.6–160.6. Full preview/trip conflicts are preserved in `v2-r04/demand-layout.json`.

Required: minimally reposition or wrap the event/recovery overlays so facility names, electrical readings and terminals remain visible. Preserve the existing visual design and passing electrical behavior. Re-evaluate changed layout only unless logic also changes.

## Passing evidence

- Independent behavior 7/7: real demand change and no early victory; prevention; hot reassignment with retained heat; trip, safe/unsafe recovery and unaffected B; pause/help/restart; preview cancellation; deterministic replay.
- Node52/52 and syntax check passed.
- A current changes from .736691 to .881998 A against .75 A capacity. B stays lit. Two distinct safe allocations complete; final each circuit about .735612 A.
- Demand change at36000ms and deterministic trip41950ms. Simulation uses50ms ticks including the application frame. Final stabilization and7-second result delay checked at tick boundaries.
- Preview/trip text stays within the viewport in6/6 checks across1280×720,390×844,600×320. Facility interference passes4/6; both600×320 states fail. Clipping-only evidence is separately preserved and is not treated as a complete layout pass.

## Evidence handling and limits

The initial `load marker absent` result was a harness exact-string error (`수요↑` versus actual `수요 ↑`). Original harness and result are preserved; the corrected7/7 result supersedes that false failure. Prior V2-R2/R3 native control evidence is reused only for unchanged controls; no claim of new physical-touch testing. Human fun, strategic learning and spontaneous replay remain unmeasured. Browser screenshots were observed, not saved as image files.