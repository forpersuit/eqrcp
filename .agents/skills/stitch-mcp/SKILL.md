---
name: stitch-mcp
description: Guide for utilizing Google AI Stitch MCP for landing page design, screen generation, timeout recovery, and Cloudflare Pages i18n deployment.
---

# Google AI Stitch MCP Design System & Deployment Guide

This skill guides future agents on using the Google AI Stitch MCP server for designing premium product websites, mitigating API timeouts during generation, and deploying landing pages with GEO-based internationalization on Cloudflare Pages.

## 1. Project & Design System Creation

To ensure premium aesthetics, always bind custom themes and design system configurations.

- **Theme Setup**: Create a project using `create_project`.
- **Applying Design Tokens**: Define a cohesive theme with `create_design_system` (e.g., using round borders, selected typography, and curated dark HSL palette colors), and then apply it to the project using `update_design_system`.
- **Aesthetic Consistency**: When prompting Stitch to generate UI screens, always supply the custom `designSystem` ID to maintain the design system's consistent style.

## 2. Mitigation of Screen Generation Timeouts (First Principles)

The `generate_screen_from_text` tool is heavy and frequently encounters HTTP timeouts or `unexpected EOF` errors. However, the generation task **continues processing asynchronously on the Cloud backend**.

### Step-by-Step Recovery Workflow:
1. **Trigger Generation**: Call `generate_screen_from_text` with your prompt and design system ID. If it times out or errors, **do not assume failure**.
2. **Asynchronous Polling**: Instead of retrying the heavy generation command, call `list_screens` for the current project.
3. **Polling Pattern**: Implement a polling loop:
   - Sleep for 30 seconds.
   - Run `list_screens`.
   - Search the screen list for the newly generated screen.
   - If not present or not fully processed, retry (up to 10 times).
4. **Direct Download**: The `get_screen` tool might also time out on large designs. Instead, extract the `htmlCode.downloadUrl` from the screen metadata returned by `list_screens` (or once `get_screen` succeeds), and fetch it directly using the `read_url_content` tool.

## 3. Directory Layout for Cloudflare Pages & GEO i18n Middleware

When deploying to Cloudflare Pages:

- **Static Assets Directory**: Keep the website static files in the `website/` directory (rather than `docs/` or `public/`) to avoid exposing internal repository documentation to the public.
- **Middleware Placement**: Cloudflare Pages Functions middleware (`functions/_middleware.js`) MUST be placed in the **repository root directory**, NOT inside the `website/` directory. Cloudflare automatically compiles the root-level `functions/` directory upon build detection.
- **Cookie & LocalStorage Integration**:
  - Middleware intercepts `CF-IPCountry` to write the initial cookie `eqt-lang=zh` (for Chinese-speaking regions like CN, HK, TW, MO) or `eqt-lang=en`.
  - Frontend scripts should check `localStorage` first (user explicit override), fallback to the `eqt-lang` cookie, and then fallback to `navigator.language`.
  - Manual language toggles must write BOTH to `localStorage` and a long-lived `eqt-lang` cookie (e.g., 365 days) to prevent the middleware from overwriting user selections on subsequent visits.
