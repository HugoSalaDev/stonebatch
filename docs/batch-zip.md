# T09 batch ZIP

`createBatchZip` receives a caller-supplied `YYYY-MM-DD` calendar date. It does not read the system clock or convert a time zone, so the future purchase flow can make that product decision explicitly. The ZIP filename removes the separators: `stonebatch-YYYYMMDD.zip`.

The archive is built entirely in the browser from existing T05 SVG exports. It contains only the ordered SVG files, `manifest.csv`, and `README.txt`.

The T09 dev/test access adapter is separate from any future licence validation. It has no URL, query parameter, storage value, user-entered value, hardcoded key, or caller-provided environment value. It only authorizes the explicit build/test `development` and `test` environments; production receives unavailable access.
