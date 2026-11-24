# Third-party notices

`dsh-unfold` bundles two pieces of open-source software so that it can read a PDF's text layer and
render a citation screenshot **without asking the user to install anything**. Both are redistributed
unmodified, and both keep their own licences — the MIT licence of this plugin does not cover them.

## pdf.js (`pdfjs-dist` 4.10.38)

- Copyright: Mozilla Foundation and PDF.js contributors
- Licence: **Apache License 2.0**
- Full text: [`vendor/package/LICENSE`](vendor/package/LICENSE)
- What we ship: `vendor/package/legacy/build/pdf.min.mjs`,
  `vendor/package/legacy/build/pdf.worker.min.mjs`, `vendor/package/cmaps/`,
  `vendor/package/standard_fonts/`
- Used for: extracting each page's text layer, with the position of every line, so a quote can be
  located on its page.

The standard fonts folder also carries its own notices, which are kept next to the files:

- `vendor/package/standard_fonts/LICENSE_FOXIT` — Foxit fonts
- `vendor/package/standard_fonts/LICENSE_LIBERATION` — Liberation fonts (SIL Open Font License 1.1)

The CMap files under `vendor/package/cmaps/` are Adobe's CMap resources, redistributed by the pdf.js
project under the terms that come with `pdfjs-dist`.

## pypdfium2 5.15.2 (and the PDFium binary it carries)

- Copyright: pypdfium2 team, and the PDFium / Chromium authors
- Licence: **BSD-3-Clause** and **Apache-2.0**, plus the licences of PDFium's own dependencies
- Full texts: [`vendor/pylib/pypdfium2-5.15.2.dist-info/licenses/`](vendor/pylib/pypdfium2-5.15.2.dist-info/licenses/)
  (`LICENSES/Apache-2.0.txt`, `LICENSES/BSD-3-Clause.txt`, and `BUILD_LICENSES/` for every library
  compiled into `pdfium.dll`)
- What we ship: `vendor/pylib/` (the wheel's contents, including `pdfium.dll`, unmodified)
- Used for: rendering the page region around a quote to a PNG, which is then inlined into the note.

Both libraries are invoked locally in-process. Nothing is uploaded: the PDFs, the extracted text and
the rendered screenshots stay on the user's machine, apart from the text of a teaching beat that the
lecture page sends to the configured speech endpoint when it is reading aloud.

## Runtime dependencies that are *not* bundled

- `@andresaya/edge-tts` — resolved from the DSH profile at runtime for speech synthesis, never
  redistributed here. The lecture falls back to the browser's own speech synthesis when it is absent.
