# SMS mobile brand guidelines

SMS is the product name, always capitalized. The wordmark uses Sora Bold with close tracking, without a graduation-cap icon. School names are account content, not replacement product branding.

## Visual identity

Use the existing shared palette in `src/ui/theme.ts`. Appearance follows the device. Keep backgrounds quiet and reserve the primary color for actions, focus, and restrained accents; do not introduce a new black/lime palette.

| Purpose | Light | Dark |
| --- | --- | --- |
| Background | `#f5f7fb` | `#0b1020` |
| Surface | `#ffffff` | `#121a2d` |
| Soft accent surface | `#edf2ff` | `#172137` |
| Primary action | `#3158df` | `#9aaeff` |
| Primary text | `#152033` | `#f5f7ff` |
| Secondary text | `#57667c` | `#a3b0c5` |
| Field border | `#d6deeb` | `#34425c` |

Sora is the only interface typeface. Use 27–30 pt for the login title/wordmark, 14–15 pt for body and inputs, and 12–13 pt only for short supporting labels. Keep system font scaling enabled. At larger font scales, allow content to wrap and scroll.

## Login composition

A centered SMS masthead, short welcome message and direct sign-in form establish the hierarchy. Keep the login free of illustration, promotional banners and decorative badges. Center the content horizontally with a 400 pt maximum width; labels stay left-aligned. On taller screens the content can center vertically; compact screens, large text and keyboard-open states start from the top and scroll.

Inputs share the same full-width shell, 56 pt minimum height, inset leading icons, and visible focus outline. Password reveal stays inside its field with a 44 pt minimum target. Never disable paste or password-manager support. The primary action has a trailing arrow and changes to a spinner plus “Signing in…” while busy.

Use a single clean background rather than nested bordered cards. Spacing follows 8/16/24 pt intervals with modest optical adjustments. The form can scroll on small screens, in landscape, and with the keyboard open; avoid fixed page heights and clipped text.

## Voice and claims

Use short, plain instructions: “Sign in to your school account.” School access is approved by the school; this screen does not offer public signup, create child links, or promise notification delivery. Password recovery opens the existing fixed SMS website URL in the system browser.

## Review checklist

- [ ] Light and Dark on an Android device.
- [ ] 360×800 viewport and larger system font settings.
- [ ] Keyboard open: both inputs, password reveal, and sign-in remain reachable.
- [ ] Autofill, paste, email Next, password Go, and screen-reader labels.
- [ ] Error, busy, access-check, and verified-role redirect states.

These visual/device items require an observed native-device check; source checks and a successful bundle do not mark them complete.
