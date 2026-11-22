# Security

## What runs where

Four Hands runs on your computer and talks to nothing on the internet by itself:

- The **app** listens only on `127.0.0.1`, with a random token created at each start and written to `bridge.json` in your user configuration folder. Only a client that can read that file (the bridge) can connect.
- The **bridge** is started by your AI client (Claude Desktop) over stdio and connects only to that local port.
- The **audio engine** is started by the app with its own token, also on `127.0.0.1`.
- **Your AI client** sends what the AI reads (your song, as compact text) to its provider, as with any conversation. Four Hands does not send anything on its own.
- **VST3 plugins** run inside the audio engine with your user's permissions, as in any DAW. Only load plugins you trust.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's private reporting instead: on the repository page, *Security > Report a vulnerability*. Include what you found, how to reproduce it and what an attacker could do with it.

You will get an answer as soon as possible. Once a fix is ready, it is released and the report is credited, unless you prefer otherwise.
