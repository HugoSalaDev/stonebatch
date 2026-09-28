# StoneBatch font asset

StoneBatch embeds one font resource and never replaces it with a system font or a network font at runtime.

| Field | Value |
|---|---|
| File | `public/fonts/montserrat-black-900-v25.woff` |
| Family | Montserrat |
| Weight/style | 900 (Black), normal |
| Format | Static WOFF1, Latin subset |
| Distribution | `@fontsource/montserrat@4.5.14` |
| Upstream metadata | Google Fonts Montserrat v25, last modified 2022-09-22 |
| Embedded font version | 8.000 |
| License | SIL Open Font License 1.1 (`public/fonts/OFL-1.1.txt`) |
| SHA-256 | `de684d0fc8ec2528aebf54b710da0ed924dc5faf3a488d37fad82c8e23ac3fec` |

The Fontsource 5.3.0 WOFF1 was evaluated first, but its kerning is stored in GPOS extension lookups (type 9), which `opentype.js` 2.0.0 reports as unsupported. The pinned Fontsource 4.5.14 static WOFF1 is the same required family, weight, style and format, exposes its kerning through supported GPOS pair positioning, and is therefore the reproducible compatible resource used by T03.

Verify the committed resource from the repository root:

```sh
sha256sum --check public/fonts/montserrat-black-900-v25.woff.sha256
```

`npm test` also parses the committed WOFF1 with `opentype.js`, checks weight 900, verifies every StoneBatch character, and observes a real negative kerning pair.
