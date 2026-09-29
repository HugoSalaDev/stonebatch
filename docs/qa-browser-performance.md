# T08 browser performance measurement

T08 records the local elapsed time from **Generate previews** until the browser Worker returns a result. The visible result includes the row and total-hole counts so a manual measurement can be repeated without sending names or geometry to a server.

Run this in a representative desktop browser after `npm run dev` or a Pages preview:

1. Enter ten valid rows and record the displayed local browser timing and hole count.
2. Enter thirty valid rows and record the displayed local browser timing and hole count.
3. Confirm the page remains responsive while the status advances by rows, then replace the list and generate again.

No representative browser or physical laptop measurement has been recorded in this repository. The T07 targets of under 3 seconds for ten names and under 10 seconds for a maximum batch therefore remain manual verification targets; no timing threshold is asserted in automated tests.
