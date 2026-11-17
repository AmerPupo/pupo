// Postbuild guard: the admin and its API are dev-only, so fail the build if either reached out/.
import { readdirSync } from "node:fs";

const OUT = "out";

let names;
try {
  names = readdirSync(OUT);
} catch {
  console.error(`assert-no-admin: ${OUT}/ is missing (did the build export?)`);
  process.exit(1);
}

// Top level only: a project slug like "api" lives under projects/ and must not trip this.
const leaked = names.filter((name) => /^(admin|api)/i.test(name));
if (leaked.length > 0) {
  const lines = leaked.map((name) => `  ${OUT}/${name}`);
  console.error(`assert-no-admin: dev-only paths found in the production build:\n${lines.join("\n")}`);
  process.exit(1);
}

console.log(`assert-no-admin: ok, no admin* or api* entries in ${OUT}/`);
