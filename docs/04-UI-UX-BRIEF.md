# 04 — UI/UX Design Brief

> The UI is **not** the graded core. It should look calm, professional and trustworthy, and it must make **honesty visible**: failures are as easy to see as successes.

| Field | Value |
|---|---|
| **Aesthetic** | Quiet monitoring tool. Clean, dense, data-first. Like Linear, the Vercel dashboard or Grafana's simpler panels. No hero images, gradients or decoration. |
| **Mode** | Light by default. Dark mode via `prefers-color-scheme` (Tailwind `dark:` variant); every token below has a dark value. |
| **Reference apps** | Linear (typography, density), Vercel dashboard (status pills, deployment log), Keepa / CamelCamelCamel (price-history chart idea) |

## Colour tokens

Define these as CSS variables in `src/index.css` via Tailwind v4's `@theme`. Components use the tokens, **never** raw hex.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F8FAFC` | `#0B0F14` | Page background |
| `--surface` | `#FFFFFF` | `#121821` | Cards, tables |
| `--border` | `#E2E8F0` | `#243041` | Hairlines |
| `--text` | `#0F172A` | `#E6EDF5` | Primary text |
| `--text-muted` | `#64748B` | `#8B98A9` | Secondary text, captions |
| `--primary` | `#4F46E5` | `#818CF8` | Buttons, links, active nav, price line |
| `--success` | `#15803D` | `#4ADE80` | Outcome `success`, in stock |
| `--retried` | `#B45309` | `#FBBF24` | Outcome `retried` |
| `--failed` | `#B91C1C` | `#F87171` | Outcome `failed`, failure ticks, out of stock |
| `--missed` | `#6B7280` | `#9CA3AF` | Missed or interrupted runs (hatched) |
| `--price-down` | `#15803D` | `#4ADE80` | Price decreased (good for the shopper) |
| `--price-up` | `#B91C1C` | `#F87171` | Price increased |

Outcome and status are **never shown by colour alone**. Always pair the colour with a text label and an icon (✓ success, ↻ retried, ✕ failed, ⏸ missed).

## Typography

- **UI font:** Inter (Google Fonts), falling back to system-ui.
- **Numbers, timestamps, IDs, CSV-like data:** JetBrains Mono, or Inter with `font-variant-numeric: tabular-nums`, so columns line up.
- Scale:
  - page title 24/32 semibold
  - section title 16/24 semibold
  - body 14/20
  - caption 12/16
  - big price on cards 28/32 semibold, tabular
- Money uses `Intl.NumberFormat` with the currency the scraper captured (probably INR → `₹12,499.00`).
- Times show in local time, `DD MMM, HH:mm`, with the full ISO UTC in a `title` tooltip. Relative time ("38 min ago") is added on the dashboard.

## Components and style

- **Corners:** 8px on cards, inputs and buttons; 999px on pills and badges.
- **Shadows:** none, or `0 1px 2px rgb(0 0 0 / .05)` on cards. Separate things with borders.
- **Spacing:** a 4px base; card padding 16px; page gutter 16px on mobile and 24px on desktop; max content width 1200px.
- **Buttons:** primary (filled `--primary`), secondary (bordered), ghost. Minimum touch target 40px tall.
- **OutcomeBadge:** pill with icon and label, soft tinted background (`color-mix` at 12%) and strong text colour.
- **StatusPill** (top bar): last run result plus the next run time.
- **Tables:** compact rows (36px), sticky header, hover highlight, numbers right-aligned. On mobile the table scrolls sideways inside its container; the page itself never does.
- **Chart:**
  - price line in `--primary`, 2px, dots on data points
  - failed attempts as `--failed` ticks on the x-axis with a tooltip ("Failed — PRICE_NOT_RENDERED after 4 tries")
  - missed slots as a light hatched band
  - tooltip shows time, price, stock and outcome
  - **no area fill, and no zero values for failures**
- **Skeletons** for loading. No spinners over whole pages.
- **Toasts** in the bottom-right (bottom-centre on mobile), 4 s.

## Layout

- **Dashboard:** status strip across the top, then a card grid (1 column on mobile, 2 at ≥768px, 3 at ≥1200px).
- **Track page:** two columns on desktop (search results on the left, product and options on the right); stacked steps on mobile.
- **Item page:** header, then a current-state panel next to the chart (stacked on mobile), then tabs (Scrape log / Price history / Product info).

## Accessibility

- Contrast ≥ 4.5:1 for text in both modes. The tokens above were chosen to meet this; check any new colour.
- Everything can be used with a keyboard. Focus rings are always visible (2px `--primary` outline, 2px offset).
- The search results list uses `role="listbox"` with arrow-key navigation. Options use a native radio group.
- The chart has a text equivalent: the Price history table.
- Honour `prefers-reduced-motion`: no animated transitions when it's set.

## Copy tone

Plain and factual. Say exactly what happened: "Failed after 4 tries — price did not render within 45 s", not "Oops! Something went wrong". Don't use emoji in the data.
