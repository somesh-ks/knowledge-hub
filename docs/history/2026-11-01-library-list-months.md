# 2026-11-01: the Library list by month, in two columns (D288)

The owner saw the list sit further under the filters than the gallery's first cover, and asked for two columns with month sections.

- Measured first: the list started 48px under the filters, the gallery 32px. The bar's own 32px plus the 16px each row keeps above its cover. One token, `--list-row-inset`, now pads the row and pulls the list up, so they cannot drift.
- Three month-head variants were laid over the real page at 390 and 1280, light and dark: A a heading like Settings', B a small muted label, C a rail beside the rows. The owner chose B and asked that it stick, at least on a phone, to give a reference while scrolling.
- Two columns only from 80rem: the column is 864px there; at 1024 it is 592px and a title would have about 280px.
- A stuck label follows the app bar with the bar's own duration and curve (`transition` on its `top`), not a script like the section tabs: only one label is ever stuck, and the tabs' glide needs a stuck-state measurement.
- The old Library test asserted "no month headings"; it now says the gallery has none. Two new journeys: label gap and sticky under the bar, and months by sort and filter with two columns.
