import fs from "node:fs";
import path from "node:path";

const SOURCE_DOCS = "/home/yelon/develop/me/eqrcp/docs";
const DEST_DOCS = "/home/yelon/develop/me/eqrcp/cloudflare/eqt-website-nimbus/src/content/docs";
const PUBLIC_IMG = "/home/yelon/develop/me/eqrcp/cloudflare/eqt-website-nimbus/public/img";

console.log("=== Copying EQT docs to Nimbus (Read-only copy, zero source mutations) ===");

// 1. Ensure target dirs
fs.mkdirSync(DEST_DOCS, { recursive: true });
fs.mkdirSync(PUBLIC_IMG, { recursive: true });

// 2. Copy images to public/img and docs/img
const sourceImg = path.join(SOURCE_DOCS, "img");
if (fs.existsSync(sourceImg)) {
  fs.cpSync(sourceImg, PUBLIC_IMG, { recursive: true });
  fs.cpSync(sourceImg, path.join(DEST_DOCS, "img"), { recursive: true });
  console.log("✓ Copied image assets to public/img/ and src/content/docs/img/");
}

function walkDir(dir, callback) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "img") continue; // handled above
      walkDir(fullPath, callback);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      callback(fullPath);
    }
  }
}

let copiedCount = 0;

walkDir(SOURCE_DOCS, (filePath) => {
  const relPath = path.relative(SOURCE_DOCS, filePath);
  if (relPath === "_config.yml") return;

  let targetRelPath = relPath;
  // If root index.md, map to intro.md to avoid collision with site landing index
  if (relPath === "index.md") {
    targetRelPath = "intro.md";
  }

  const destPath = path.join(DEST_DOCS, targetRelPath);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  const rawContent = fs.readFileSync(filePath, "utf8");

  let finalContent = rawContent;
  const hasFrontmatter = rawContent.startsWith("---");

  if (!hasFrontmatter) {
    // Extract first H1 heading
    const h1Match = rawContent.match(/^#\s+(.+)$/m);
    let title = "";
    if (h1Match) {
      title = h1Match[1].trim()
        .replace(/^[📘🔒⚠️\s]+/, "") // strip emoji prefixes
        .replace(/[`*_]/g, "") // strip markdown format
        .replace(/"/g, '\\"'); // escape double quotes
      
      // Remove the H1 line so it doesn't duplicate the layout H1
      const lines = rawContent.split("\n");
      const h1Idx = lines.findIndex((l) => l.startsWith("# "));
      if (h1Idx !== -1) {
        lines.splice(h1Idx, 1);
        while (lines.length > 0 && (lines[0].trim() === "" || lines[0].trim() === "---")) {
          lines.shift();
        }
        finalContent = lines.join("\n").trimStart();
      }
    } else {
      title = path.basename(filePath, ".md").replace(/[-_]/g, " ");
      const lines = rawContent.split("\n");
      while (lines.length > 0 && (lines[0].trim() === "" || lines[0].trim() === "---")) {
        lines.shift();
      }
      finalContent = lines.join("\n").trimStart();
    }

    finalContent = `---\ntitle: "${title}"\n---\n\n${finalContent}`;
  } else {
    // Check if frontmatter has title
    const endFmIdx = rawContent.indexOf("\n---", 3);
    if (endFmIdx !== -1) {
      const fm = rawContent.slice(3, endFmIdx);
      if (!/^\s*title\s*:/m.test(fm)) {
        // Need to add title
        const body = rawContent.slice(endFmIdx + 4);
        const h1Match = body.match(/^#\s+(.+)$/m);
        let title = h1Match ? h1Match[1].trim().replace(/[`*_"]/g, "") : path.basename(filePath, ".md");
        finalContent = `---\ntitle: "${title}"\n${fm.trim()}\n---${body}`;
      }
    }
  }

  fs.writeFileSync(destPath, finalContent, "utf8");
  copiedCount++;
});

console.log(`✓ Successfully copied and prepared ${copiedCount} docs files into ${DEST_DOCS}`);
