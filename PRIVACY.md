# Jeom Privacy Policy

Jeom is a bring-your-own-key Chrome extension. It reads the article page you
choose to annotate and sends relevant text to the LLM provider you configure.

## Data stored on your device

Jeom stores your selected provider, model, endpoint (when applicable), and API
key in `chrome.storage.local`. The API key is sent only to your chosen LLM
provider to generate annotations. Jeom does not send your API key to its
diagnostic service.

## Optional diagnostics

Diagnostic sharing is off by default. If you explicitly enable it in Settings,
Jeom may send successful annotation-session diagnostics to help improve article
selection, note quality, and rendering. Those diagnostics can include:

- Page URL and title
- Extension version and browser user agent
- The selected provider and model
- Article-selection and note-generation prompts and responses
- Rendering counts and related debug metadata

Jeom never intentionally includes your API key in diagnostics. Do not enable
diagnostic sharing on pages containing information you would not want to share
for debugging.

## Sharing and retention

Jeom does not sell data, use it for advertising, or share it with third parties
other than infrastructure providers used to operate the opted-in diagnostic
service. The extension has no account system and no first-party server is used
to generate annotations.
