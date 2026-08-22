# Changelog

## v0.3.0 — Bring your own model

- Connect Jeom to 17 hosted, cloud, local, and custom LLM services from one
  settings page, including OpenRouter, OpenAI, Anthropic, Gemini, Ollama, and
  OpenAI- or Anthropic-compatible endpoints.
- Discover available models and test a connection before saving it.
- Use a simpler, functional settings layout with in-situ dots selected by
  default and advanced controls kept out of the main flow.
- Keep API keys in extension-local storage and out of article-page content
  scripts while routing every reading request through the background worker.
- Preserve existing three-provider settings and legacy Anthropic model aliases
  during the upgrade.

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
