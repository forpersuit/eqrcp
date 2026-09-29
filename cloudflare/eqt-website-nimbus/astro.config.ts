import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import nimbus, {
  defineConfig as defineNimbusConfig,
} from "@cloudflare/nimbus-docs";
import { tableScroll } from "@cloudflare/nimbus-docs/markdown";

const nimbusConfig = defineNimbusConfig({
  site: "https://docs.eqt.net.im",
  title: "EQT 官方技术文档中心",
  description: "局域网高速传输、Chat 模式、P2P 穿透、Ed25519 DRM 与 LAN-TLS 核心架构全景指南",
  locale: "zh",
  github: null,
  socialImageAlt: "EQT 文档预览",
  sidebar: {
    items: [
      // 简体中文
      { label: "产品概览", link: "/zh/intro" },
      { label: "用户使用指南", autogenerate: { directory: "zh/guides" } },
      { label: "故障排查与 FAQ", autogenerate: { directory: "zh/troubleshooting" } },
      { label: "CLI 极客手册", autogenerate: { directory: "zh/cli" } },
      { label: "安全与隐私白皮书", autogenerate: { directory: "zh/security" } },

      // English
      { label: "Product Overview", link: "/en/intro" },
      { label: "User Guides", autogenerate: { directory: "en/guides" } },
      { label: "Troubleshooting & FAQ", autogenerate: { directory: "en/troubleshooting" } },
      { label: "CLI Manual", autogenerate: { directory: "en/cli" } },
      { label: "Security & Privacy", autogenerate: { directory: "en/security" } },
      // Français
      { label: "Vue d'ensemble", link: "/fr/intro" },
      { label: "Guides d'utilisation", autogenerate: { directory: "fr/guides" } },
      { label: "Dépannage et FAQ", autogenerate: { directory: "fr/troubleshooting" } },
      { label: "Manuel CLI", autogenerate: { directory: "fr/cli" } },
      { label: "Sécurité et confidentialité", autogenerate: { directory: "fr/security" } },
    ],
  },
});

export default defineConfig({
  redirects: {
    "/intro": "/zh/intro",
    "/guides/quickstart": "/zh/guides/quickstart",
    "/guides/chat-mode": "/zh/guides/chat-mode",
    "/guides/free-vs-plus": "/zh/guides/free-vs-plus",
    "/troubleshooting/firewall-and-lan": "/zh/troubleshooting/firewall-and-lan",
    "/troubleshooting/https-and-certificates": "/zh/troubleshooting/https-and-certificates",
    "/troubleshooting/faq": "/zh/troubleshooting/faq",
    "/cli/commands": "/zh/cli/commands",
    "/cli/configuration": "/zh/cli/configuration",
    "/security/whitepaper": "/zh/security/whitepaper",
    "/zh": "/zh/intro",
    "/en": "/en/intro",
    "/fr": "/fr/intro",
  },
  // nimbus:adapter
  output: "static",
  // Tailwind v4 via its Vite plugin (the integration Astro recommends for
  // Tailwind v4 — replaces the PostCSS plugin, which doesn't build under
  // Astro 7's Vite 8 bundler).
  vite: {
    plugins: [tailwindcss()],
  },
  // Hover-prefetch link targets so full-page navigations feel instant without
  // a client-side router.
  prefetch: {
    prefetchAll: true,
    defaultStrategy: "hover",
  },
  integrations: [
    nimbus(nimbusConfig, {
      // Authoring rules are opt-in by design — your repo, your taste. The
      // two below are the load-bearing pair: frontmatter has to validate
      // against the content schema for the page to render properly, and
      // broken internal links are 404s for your readers. Add the others
      // (heading hierarchy, code-block language, style, etc.) when you're
      // ready to enforce them — see `nimbus-docs lint --help`.
      rules: {
        "nimbus/frontmatter-shape": "error",
        "nimbus/internal-link": "warn",
      },
      // Wrap wide tables so they scroll instead of overflowing the page
      // (styled by `.nb-table-scroll` in src/styles/prose.css).
      markdown: {
        hastPlugins: [tableScroll()],
      },
    }),
  ],
});
