# Page Copilot Privacy Policy

Effective date: October 29, 2026

Publisher: Muhammad Burhan

Contact: Burhan182001@gmail.com

## What the extension processes

Page Copilot helps you summarize, question, explain, and translate web pages.
When you run an action, it reads the current page's title, URL, and readable text,
or the text you selected. Your question, relevant chat history, and response
language may also be included in an AI request.

The extension reads active-tab metadata to show which page you are using. It
does not automatically send page text to an AI provider merely because you
visit a page.

## Cloud providers and local models

In cloud mode, requests are sent directly from your browser to the provider
selected by your API key: Google Gemini, OpenAI, or Groq. Your API key is sent
to that provider to authenticate requests. Testing a cloud key sends a small
test message. The provider's own privacy and retention terms apply:

- Google Gemini: https://ai.google.dev/gemini-api/terms
- OpenAI: https://openai.com/policies/privacy-policy/
- Groq: https://groq.com/privacy-policy/

In local mode, AI requests are sent to your local llama.cpp server at
`http://127.0.0.1:8090`. Page Copilot does not send these local-model requests
to a cloud AI provider. Listing or testing local models contacts that server.

Page Copilot does not operate an application backend or include analytics
or advertising trackers.

## Browser storage

- Your API key is stored in `chrome.storage.local`, not Chrome sync storage.
- Preferences, including language, summary length, and local-model settings,
  are stored in `chrome.storage.sync` and may sync through your browser account.
- Per-tab conversations and pending selection actions are stored in
  `chrome.storage.session`; they are not intended as permanent records.

You can clear a conversation with Clear chat, remove your key in Settings,
or uninstall the extension to remove its browser-managed extension storage.
These actions do not delete information already received by an AI provider.

## Permissions

Page access and scripting support readable-text extraction. Tab access
identifies the current page. Context-menu access provides selection actions.
Side-panel access displays the assistant. Storage access saves settings,
credentials, and session conversations. Provider and loopback network access
allow the AI requests described above.

## Your choices and contact

Choose local mode if you do not want page content sent to a cloud AI provider.
Avoid submitting sensitive page content unless you intend to share it with
your selected provider. For privacy questions, contact Muhammad Burhan at
Burhan182001@gmail.com.

Changes to this policy will be published here with an updated effective date.
