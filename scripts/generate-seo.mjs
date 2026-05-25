/**
 * Generuje robots.txt i sitemap.xml w katalogu głównym projektu
 * na podstawie assets/seo/site-origin.json
 *
 * Uruchomienie: npm run seo:generate
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const cfgPath = join(root, "assets/seo/site-origin.json");

let origin = "";
try {
  const raw = JSON.parse(readFileSync(cfgPath, "utf8"));
  origin = String(raw.origin || "").trim().replace(/\/$/, "");
} catch {
  console.error("Nie znaleziono lub błąd odczytu:", cfgPath);
  process.exit(1);
}

if (!origin || !/^https:\/\//i.test(origin)) {
  console.error(
    'Uzupełnij poprawny "origin" (np. https://sredzka-korona.pl) w assets/seo/site-origin.json'
  );
  process.exit(1);
}

/**
 * Ścieżki kanoniczne (końcowy slash zgodny z linkami wewnętrznymi).
 * Tylko strony indeksowalne i z realną treścią.
 */
const urls = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/Hotel/", changefreq: "weekly", priority: "0.9" },
  { path: "/catering/", changefreq: "weekly", priority: "0.9" },
  { path: "/przyjecia/", changefreq: "weekly", priority: "0.9" },
  { path: "/kontakt/", changefreq: "monthly", priority: "0.85" },
  { path: "/dokumenty/", changefreq: "monthly", priority: "0.7" },
  { path: "/f-and-q/", changefreq: "monthly", priority: "0.75" },
];

const lastmod = new Date().toISOString().slice(0, 10);

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (item) => `  <url>
    <loc>${origin}${item.path}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${item.changefreq}</changefreq>
    <priority>${item.priority}</priority>
  </url>`
  )
  .join("\n")}
</urlset>
`;

const robots = `User-agent: *
Allow: /

Disallow: /admin/
Disallow: /functions/
Disallow: /worker/
Disallow: /scripts/
Disallow: /Hotel/potwierdzenie.html
Disallow: /Hotel/akceptacja.html
Disallow: /catering/potwierdzenie.html
Disallow: /catering/akceptacja.html
Disallow: /przyjecia/potwierdzenie.html
Disallow: /przyjecia/akceptacja.html

Sitemap: ${origin}/sitemap.xml
`;

writeFileSync(join(root, "sitemap.xml"), sitemap, "utf8");
writeFileSync(join(root, "robots.txt"), robots, "utf8");

console.log("Zapisano: sitemap.xml, robots.txt");
console.log("Origin:", origin);
