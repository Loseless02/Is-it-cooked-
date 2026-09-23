# Security Policy

## Supported versions

Only the latest release gets security fixes.

| Version | Supported |
|---|---|
| Latest release | ✅ |
| Older releases | ❌ |

## Reporting a vulnerability

**Please don't open a public issue for security problems.**

Report it privately through GitHub instead:
**[Report a vulnerability](https://github.com/Loseless02/Is-it-cooked-/security/advisories/new)**
(repository → *Security* tab → *Report a vulnerability*).

Please include:

- What the problem is and what an attacker could do with it
- Steps to reproduce (or a proof of concept)
- The app version and your Windows version

You can expect a first reply within **7 days**. Once a fix is released, you'll be credited in the release notes unless you'd rather stay anonymous.

## What the app does on your system

Is It Cooked? runs on a PC you may not own yet, so here is exactly what it does:

**Reads (never changes)**

- Hardware info: CPU, GPU, RAM, drives, battery, displays, network adapters
- Windows info: version, activation status, install date
- The list of running processes, to find heavy background apps

**Temporarily does**

- Runs CPU, RAM and GPU stress tests (the PC gets warm and loud; that's the point)
- Writes a test file of up to 1 GB to the Windows temp folder to measure drive speed, and **deletes it** right after
- Uses the camera and microphone **only** while you have the webcam or microphone test open. Nothing is recorded, saved or sent anywhere
- Keeps the screen awake while tests run

**Only when you click a button**

- Closes background apps you choose in the "Clear the kitchen" list. Only apps from that list can be closed; Windows system processes are never offered
- Opens Windows display settings (for "fix your refresh rate")
- Restarts itself with admin rights (Windows asks you first)
- Saves an HTML report to a location you pick

**Network**

- One request to `http://www.msftconnecttest.com/connecttest.txt` (the same check Windows uses) to see whether the PC is online
- No telemetry, no analytics, no accounts. Results never leave the PC unless you share the report yourself

## Why it asks for admin rights

The packaged app asks for administrator rights on launch. Admin access is only used to **read** drive health counters (wear, power-on hours), CPU temperature sensors, and to run Windows' built-in disk assessment (`winsat`) for a real read-speed number. You can decline and the app still runs every other test.

## App hardening

- The UI runs with `contextIsolation`, `sandbox` and no Node.js integration; it can only call a small, fixed set of functions exposed by `preload.js`
- A strict Content-Security-Policy blocks remote scripts
- Navigation and new windows are blocked
- Only `ms-settings:` links can be opened from the app
- The release `.exe` is currently **not code-signed**, so Windows SmartScreen may warn. If you prefer, build it yourself from source (see the README)
