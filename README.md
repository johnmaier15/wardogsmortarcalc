# WARDOGS Mortar Calc

Screenshot-driven mortar calculator for **WARDOGS**. Take a screenshot of the
tactical map with the cursor over your gun, another with the cursor over the
target, paste both into the page, and it tells you the azimuth, elevation in
mils, and range to dial into the L81 mortar (or the SPH-2).

Everything runs in the browser. No server, no uploads; screenshots never leave
your machine.

## Using it

1. In game, open the tactical map and hover over your mortar so the `X / Y`
   readout is visible. Take a screenshot (`Win+Shift+S` and snipping just the
   readout is fastest, but a full-screen `PrtScn` works too).
2. Paste it into **1. Your mortar**. The page finds and reads the numbers.
   If it misreads, drag a box tightly around the readout to re-scan just that
   area, or type the values in. The box is remembered for the next screenshot
   of the same size.
3. Repeat for **2. Target**. You can also paste a squad-chat line from
   *Mark Coordinates* (`x87.10, y44.65`) into the text field.
4. Read **3. Fire mission**: azimuth (degrees, and mils), elevation (mils),
   range. Copy it to chat with one click.
5. After a miss, open *Adjust fire after a miss*, enter how far the round
   landed long/short and left/right, and the aim point shifts for you.

Your gun position and weapon choice are remembered between visits.

## How the maths works

- Map coordinates: `1.00` = 100 m, so `0.01` = 1 m. X grows east, Y grows north.
- Range is the straight-line distance between the two points.
- Azimuth is a compass bearing: 0° north, 90° east, clockwise.
- Elevation comes from linear interpolation of a range → mil firing table.

The firing tables (L81 Mortar 132–684 m, SPH-2 780–2629 m with low and high
arcs) are community measurements from the MIT-licensed
[wardogs-calculator](https://github.com/apollyon-sys/wardogs-calculator)
project by Apollyon. They are not an official BULKHEAD publication and may
drift between patches; see `data/weapons.js` to update them.

## OCR

Text recognition uses [Tesseract.js](https://github.com/naptha/tesseract.js),
vendored under `vendor/` so the site works from any static host with no CDN.
HUD text is near-white on a dark box, so the page thresholds the screenshot to
keep only bright pixels before recognising; that lets one pass over a full
1080p frame read the readout in about a second. Dimmer or coloured text, and
dark text on a light map, are covered by fallback passes.

## Development

```bash
npm install          # dev dependencies only (tesseract.js, for vendoring)
npm test             # unit tests for the maths and the OCR text extractor
npm run serve        # static server on http://localhost:8000
npm run vendor       # refresh vendor/ from node_modules after upgrading tesseract.js
```

End-to-end check in headless Chromium (needs Playwright and a server on :8000):

```bash
node test/e2e/run.mjs
```

It renders synthetic HUD screenshots, runs them through the real page, and
asserts on the OCR result and the firing solution.

## Layout

```
index.html        page
styles.css
src/app.js        UI: paste/drop, region drag, results, corrections
src/ocr.js        Tesseract wrapper and image preprocessing
src/extract.js    pull X/Y out of noisy OCR text (pure, unit-tested)
src/ballistics.js distance, azimuth, mil interpolation, miss correction (pure, unit-tested)
data/weapons.js   firing tables
vendor/           Tesseract.js runtime and English language data
```

## Deploying

The repository is a static site; serve the root directory. The included
GitHub Actions workflow runs the tests and publishes to GitHub Pages on every
push to `main`. Enable it once under **Settings → Pages → Source: GitHub Actions**.

## License

MIT. Firing-table data is from the MIT-licensed wardogs-calculator project.
Unofficial fan project, not affiliated with or endorsed by BULKHEAD or the
WARDOGS development team.
