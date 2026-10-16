<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Linear transcript viewport contract

`apps/web/components/workspace/transcript-viewport-model.ts` owns viewport behavior.
For behavioral changes, update a semantic transition or invariant and its sequence
tests, then exercise the actual browser gesture when input is involved. Feature
components submit navigation requests; browser handlers normalize observations.
Neither chooses following policy or writes the outer scroll offset. Geometry and
write acknowledgements cannot change the persistent mode. Keep browser/React
imports and browser globals out of the pure model. Read its module contract before
changing transcript scrolling; preserve one-time version alignment, natural clamps,
and the reading position on send/draft persistence.
