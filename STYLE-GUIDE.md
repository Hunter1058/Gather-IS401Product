# Campusly Style Guide

The visual language for Campusly — a frosted-glass campus events app built on Tailwind CSS v4 with semantic design tokens. All colors are defined in `src/styles.css` in **oklch** format and themed through shadcn-style semantic variables.

---

## 1. Brand Personality

- **Direction:** "Frosted Campus Glass" — light, airy, glassmorphic panels floating on a soft cool-toned gradient.
- **Feel:** modern, approachable, student-friendly. Clean cards with soft depth — not corporate, not neon.
- **Accent energy:** indigo/violet primary with sky-blue accent; coral and mint reserved for playful highlights (food, success, event category thumbs).

---

## 2. Typography

| Role | Font | Notes |
|---|---|---|
| Display / headings | **Space Grotesk** (`--font-display`) | Section titles, event banners, app name |
| Body / UI | **Inter** (`--font-body`) | Everything else; default body font |

Sizes & weights in active use:

| Element | Size | Weight |
|---|---|---|
| Section title | 1.25rem (20px) | 700 |
| Event banner text | 1.1rem | 700 |
| Event detail lines | 0.875rem (14px) | 600 |
| Nav links | 0.875rem | 600 |
| Info pills / tags | 0.75rem / 0.68rem | 600–650 |
| Event kicker (eyebrow) | 0.7rem | 700, uppercase |

Load fonts via `<link>` tags in the root route head — never `@import` a remote URL in CSS.

---

## 3. Color Palette

### Core tokens

| Token | Light value (oklch) | Use |
|---|---|---|
| `--background` | `oklch(0.96 0.025 230)` | Page base (layered under gradient) |
| `--foreground` | `oklch(0.2 0.055 260)` | Primary text |
| `--card` | `oklch(1 0 0)` | Card surfaces |
| `--primary` | `oklch(0.45 0.2 270)` | Indigo — buttons, active nav, links |
| `--primary-foreground` | `oklch(0.99 0 0)` | Text on primary |
| `--secondary` | `oklch(0.94 0.025 250 / 75%)` | Soft secondary surfaces |
| `--muted-foreground` | `oklch(0.5 0.04 255)` | Secondary text, labels |
| `--accent` | `oklch(0.77 0.13 215)` | Sky blue — gradients, highlights |
| `--destructive` | `oklch(0.577 0.245 27.325)` | Errors, destructive actions |
| `--border` | `oklch(0.86 0.035 250 / 70%)` | Hairline borders |

### Brand accents

| Token | Value | Use |
|---|---|---|
| `--coral` | `oklch(0.68 0.18 35)` | Warm event highlights (food, social) |
| `--mint` | `oklch(0.72 0.14 160)` | Success / fresh category accents |

### Surfaces & overlays

| Token | Value | Use |
|---|---|---|
| `--surface` | `oklch(1 0 0 / 62%)` | Translucent glass surfaces |
| `--overlay` | `oklch(0.18 0.05 260)` | Modal backdrops |

### Rule

Never hardcode color utilities (`bg-black`, `bg-[#...]`) in components — always use semantic tokens (`bg-primary`, `text-muted-foreground`, etc.) so theming and dark mode stay consistent.

---

## 4. Gradients

| Element | Gradient |
|---|---|
| Page background (`campus-page`) | `linear-gradient(135deg, oklch(0.92 0.06 270), oklch(0.93 0.065 210) 48%, oklch(0.94 0.055 295))` — soft indigo → aqua → lavender |
| Avatar chip | `linear-gradient(135deg, var(--primary), var(--accent))` |

Category thumbnail & banner gradients (135°, pastel two-stop):

| Variant | Example use |
|---|---|
| `*-primary` (indigo → sky) | Default / featured events |
| `*-aqua` (aqua → blue) | Culture, music |
| `*-coral` (coral → warm) | Food, social events |
| `*-mint` (mint → aqua) | Outdoors, wellness |

---

## 5. Radii & Shadows

| Token | Value | Notes |
|---|---|---|
| `--radius` | 0.75rem (12px) | Base radius |
| `radius-md` / `lg` | 10px / 12px | Cards, inputs |
| `radius-xl`–`4xl` | 16–28px | Glass panels, banners, modals |
| Pills | 999px | Tags, kickers, info pills, avatars |

Shadow system: soft, low-opacity indigo-tinted shadows.

- Glass panel: `0 18px 45px oklch(0.3 0.08 270 / 9%)`
- Active nav link: `0 4px 12px oklch(0.3 0.08 270 / 8%)`

---

## 6. Glass Panels

The signature surface:

```css
@utility glass-panel {
  border: 1px solid oklch(1 0 0 / 62%);
  border-radius: 1rem;
  background: oklch(1 0 0 / 55%);
  box-shadow: 0 18px 45px oklch(0.3 0.08 270 / 9%);
  backdrop-filter: blur(18px);
}
```

Use for: main content cards, modals, nav containers. Translucent event rows use ~34% white with a 52% white border and brighten to ~55% on hover.

---

## 7. Components & Patterns

| Pattern | Spec |
|---|---|
| **Nav link** | 0.55/0.9rem padding, 0.6rem radius, 600 weight; hover = 45% white bg; active = 72% white bg + primary text |
| **Avatar chip** | 2.5rem circle, primary→accent gradient, white 0.75rem initials, 700 weight |
| **Event kicker** | Inline pill, primary at 10% alpha bg, uppercase 0.7rem 700 |
| **Info pill** | 999px pill, 58% white bg, 0.75rem 600, small icon (0.8rem) |
| **Tag** | 999px pill, 58% white bg, 0.68rem 650, muted text |
| **Event row** | Flex row, thumb (4rem, category gradient, 0.7rem radius) + text; hover brightens and tints border toward primary |
| **Detail line** | 0.75rem radius, 42% white bg, 0.8rem padding, 600 weight, primary-colored 1rem icon |
| **Event banner** | Min 9rem height, category gradient, display font 1.1rem 700, content anchored bottom |

Icons: **Lucide**, stroke icons, sized via CSS (`0.8rem`–`1rem`), primary-colored when inside detail lines.

---

## 8. Motion & Accessibility

- Transitions: `0.2s ease` on interactive surfaces (rows, nav links).
- Reduced motion: a global `prefers-reduced-motion` rule collapses all transitions to `0.01ms` and disables smooth scrolling — keep it.
- Contrast: dark indigo foreground (`oklch(0.2 0.055 260)`) on light glass ensures WCAG-friendly contrast; muted text stays ≥ 0.5 lightness.
- Touch targets: pills and nav links keep ≥ 0.55rem vertical padding.

---

## 9. Do / Don't

**Do**
- Use semantic tokens for every color.
- Keep glass surfaces subtle — 55–62% white, never fully opaque over the gradient.
- Reserve coral/mint for category and status accents, not primary actions.
- Use Space Grotesk only for display text; Inter for everything readable.

**Don't**
- Hardcode hex values or raw color utilities in components.
- Use purple/indigo "AI gradient" hero-on-white layouts — Campusly floats glass on a full-page gradient instead.
- Stack heavy shadows — one soft shadow layer per surface.
- Mix other display fonts or serif type.
