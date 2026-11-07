# Kosha brand assets

The logo is the showcase site's mark ([`Mark.tsx`](../../apps/site/components/elements/Mark.tsx)):
one amount split into two legs, the small one set aside for tax. The wordmark is "Kosha" in Host
Grotesk Medium. Colours are the site's tokens ([`globals.css`](../../apps/site/app/globals.css)).

| Token  | Hex       | Use                       |
| ------ | --------- | ------------------------- |
| Accent | `#5ab9fc` | The mark                  |
| Ground | `#0a0d14` | Dark background, dark ink |
| Ink    | `#e9edf3` | Text on dark, light paper |

| File                                        | Use                                                  |
| ------------------------------------------- | ---------------------------------------------------- |
| `kosha-icon-1024.png`, `kosha-icon-512.png` | Square icon or avatar on the dark background         |
| `kosha-icon.svg`                            | The square icon as a vector                          |
| `kosha-mark.svg`                            | The mark alone as a vector, as on the site           |
| `kosha-mark-transparent-1024.png`           | The mark alone, no background                        |
| `kosha-logo-on-dark.png`                    | Mark and wordmark on the dark background, 1600×520   |
| `kosha-logo-on-light.png`                   | Mark and wordmark in dark ink on light paper         |
| `kosha-logo-transparent-light-text.png`     | Mark and wordmark, no background, for dark surfaces  |
| `kosha-logo-transparent-dark-text.png`      | Mark and wordmark, no background, for light surfaces |

The PNGs were rendered in Chrome from the site's own mark and font, with the footer's spacing
(mark 32 px, text 28 px, gap 12 px) scaled up 8×. The wordmark exists only as PNG; the SVGs hold the
mark alone, so they need no font.
