# Changelog

## v0.2.0 — Public source release

- Published Jeom as an experimental, source-installable Chrome extension.
- Added a product-focused README, contributor guidance, security reporting,
  and continuous integration.
- Made diagnostic sharing opt-in by default.
- Fixed abbreviation boundaries so titles/initials such as `Sen.`, `Rep.`,
  `Dr.`, `e.g.`, and `J. R. R.` do not become annotation dots.
- Added marker persistence so dots are restored if a host page re-renders the
  annotated article subtree.
- Fixed repeated activation on an already-annotated page so existing dots are
  restored to periods before re-segmentation instead of disappearing.
- Updated marker and note typography so dots scale with article text and hover
  notes inherit an editorial article font stack with Korean fallbacks.
- Added a popup content-script injection fallback so already-open article tabs
  can recover from missing MV3 content-script receivers without a page refresh.
