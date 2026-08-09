/**
 * Samanhyia Health Center — build script
 *
 * Reads content saved via the Decap/DecapBridge CMS (markdown files under
 * admin/collections/ and admin/content/) and injects it into the static
 * HTML pages between marker comments, so the live site always reflects
 * whatever was last saved in the CMS.
 *
 * Runs automatically on Netlify via netlify.toml's build command.
 * Output goes to /dist, which is what Netlify publishes.
 */

const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");

const ROOT = __dirname;
const DIST = path.join(ROOT, "dist");

// ---------- small helpers ----------

function readDir(dir) {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) return [];
  return fs
    .readdirSync(full)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const raw = fs.readFileSync(path.join(full, f), "utf8");
      const { data } = matter(raw);
      return data;
    });
}

function readFile(relPath) {
  const full = path.join(ROOT, relPath);
  if (!fs.existsSync(full)) return {};
  const raw = fs.readFileSync(full, "utf8");
  return matter(raw).data;
}

// escape basic HTML special chars for text pulled from CMS fields
function esc(str) {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// very small markdown -> HTML: paragraphs on blank lines, **bold**
function mdToHtml(str) {
  if (!str) return "";
  return String(str)
    .trim()
    .split(/\n\s*\n/)
    .map((para) => {
      const escaped = esc(para.trim()).replace(
        /\*\*(.+?)\*\*/g,
        "<strong>$1</strong>"
      );
      return `<p>${escaped}</p>`;
    })
    .join("\n");
}

// replace content between <!-- BUILD:NAME --> and <!-- /BUILD:NAME -->
function injectBlock(html, blockName, replacement) {
  const startTag = `<!-- BUILD:${blockName} -->`;
  const endTag = `<!-- /BUILD:${blockName} -->`;
  const start = html.indexOf(startTag);
  const end = html.indexOf(endTag);
  if (start === -1 || end === -1) {
    console.warn(`  ! Marker "${blockName}" not found, skipping`);
    return html;
  }
  const before = html.slice(0, start + startTag.length);
  const after = html.slice(end);
  return `${before}\n${replacement}\n${after}`;
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const item of fs.readdirSync(src)) {
      copyRecursive(path.join(src, item), path.join(dest, item));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

// ---------- 1. copy everything into dist first ----------

console.log("Copying site files into dist/ ...");
if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

const SKIP = new Set([
  "dist",
  "node_modules",
  ".git",
  "build.js",
  "package.json",
  "package-lock.json",
]);

for (const item of fs.readdirSync(ROOT)) {
  if (SKIP.has(item)) continue;
  copyRecursive(path.join(ROOT, item), path.join(DIST, item));
}

// ---------- 2. build homepage (index.html) ----------

console.log("Building index.html ...");
{
  let html = fs.readFileSync(path.join(DIST, "index.html"), "utf8");

  // Hero section
  const hero = readFile("admin/content/home/hero.md");
  if (hero.title || hero.message) {
    const heroHtml = `<h2>${esc(hero.title || "")}</h2>
<p>${esc(hero.message || "")}</p>
<a href="contact.html" class="btn">${esc(hero.button_text || "Emergency Contact")}</a>`;
    html = injectBlock(html, "HERO", heroHtml);
  }

  // Leadership messages
  const leadership = readFile("admin/content/leadership/welcome.md");
  const messages = readDir("admin/collections/messages").sort(
    (a, b) => (a.order || 0) - (b.order || 0)
  );

  let leadershipHtml = "";
  if (leadership.enabled !== false && messages.length > 0) {
    const cards = messages
      .map((m) => {
        const photo = m.photo
          ? `<div class="message-photo"><img src="${esc(
              m.photo
            )}" alt="${esc(m.title)} Photo" loading="lazy"></div>`
          : "";
        return `<div class="message-card">
  ${photo}
  <h3>${esc(m.title)}</h3>
  <p class="role">${esc(m.role)}</p>
  <div class="message-content">
    ${mdToHtml(m.message)}
  </div>
</div>`;
      })
      .join("\n");
    leadershipHtml = `<h2>${esc(
      leadership.title || "Welcome Messages from Our Leadership"
    )}</h2>
<div class="messages-grid">
${cards}
</div>`;
  }
  html = injectBlock(html, "LEADERSHIP", leadershipHtml);

  fs.writeFileSync(path.join(DIST, "index.html"), html);
}

// ---------- 3. build facilities.html ----------

console.log("Building facilities.html ...");
{
  let html = fs.readFileSync(path.join(DIST, "facilities.html"), "utf8");

  const facilities = readDir("admin/collections/facilities").sort(
    (a, b) => (a.order || 0) - (b.order || 0)
  );

  const main = facilities.find((f) => f.type === "Main Center");
  const others = facilities.filter((f) => f.type !== "Main Center");

  function facilityDetails(f) {
    const rows = [
      `<p><strong>Location:</strong> ${esc(f.location)}</p>`,
      `<p><strong>Services:</strong> ${esc(f.services)}</p>`,
      `<p><strong>Hours:</strong> ${esc(f.hours)}</p>`,
    ];
    if (f.phone) rows.push(`<p><strong>Contact:</strong> ${esc(f.phone)}</p>`);
    if (f.notes) rows.push(`<p class="notes">${esc(f.notes)}</p>`);
    return rows.join("\n    ");
  }

  if (main) {
    const mainHtml = `<div class="facility-card main">
  <div class="facility-header">
    <h3>${esc(main.title)} <span class="badge">Main</span></h3>
  </div>
  <div class="facility-details">
    ${facilityDetails(main)}
  </div>
</div>`;
    html = injectBlock(html, "MAIN_FACILITY", mainHtml);
  }

  const chpsHtml = others
    .map(
      (f) => `<div class="facility-card">
  <h4>${esc(f.title)}</h4>
  <div class="facility-details">
    ${facilityDetails(f)}
  </div>
</div>`
    )
    .join("\n");
  html = injectBlock(html, "CHPS_FACILITIES", chpsHtml);

  fs.writeFileSync(path.join(DIST, "facilities.html"), html);
}

console.log("Build complete. Output in /dist");
