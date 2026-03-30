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
    'Uzupełnij poprawny "origin" (np. https://www.sredzkakorona.pl) w assets/seo/site-origin.json'
  );
  process.exit(1);
}

/** Ścieżki kanoniczne (końcowy slash zgodny z linkami wewnętrznymi) */
const paths = [
  "/",
  "/Hotel/",
  "/Restauracja/",
  "/Przyjec/",
  "/kontakt/",
  "/dokumenty/",
];

const lastmod = new Date().toISOString().slice(0, 10);

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths
  .map(
    (p) => `  <url>
    <loc>${origin}${p}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${p === "/" ? "weekly" : "monthly"}</changefreq>
    <priority>${p === "/" ? "1.0" : "0.85"}</priority>
  </url>`
  )
  .join("\n")}
</urlset>
`;

const robots = `User-agent: *
Allow: /

Disallow: /admin/
Disallow: /Hotel/potwierdzenie.html
Disallow: /Restauracja/potwierdzenie.html
Disallow: /Przyjec/potwierdzenie.html

Sitemap: ${origin}/sitemap.xml
`;

writeFileSync(join(root, "sitemap.xml"), sitemap, "utf8");
writeFileSync(join(root, "robots.txt"), robots, "utf8");

console.log("Zapisano: sitemap.xml, robots.txt");
console.log("Origin:", origin);
