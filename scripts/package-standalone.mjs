// Assemble a deployable Next.js standalone bundle for Azure App Service.
// Output: ./deploy (run with `node server.js`), plus ./deploy.zip if `zip` is available.
import { cpSync, existsSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";

const out = "deploy";
if (!existsSync(".next/standalone")) {
  console.error("Run `npm run build` first (next.config.ts sets output: 'standalone').");
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
cpSync(".next/standalone", out, { recursive: true });
cpSync(".next/static", `${out}/.next/static`, { recursive: true });
if (existsSync("public")) cpSync("public", `${out}/public`, { recursive: true });
try {
  rmSync("deploy.zip", { force: true });
  execSync(`cd ${out} && zip -qr ../deploy.zip .`, { stdio: "inherit" });
  console.log("Created deploy.zip");
} catch {
  console.log("zip not available — deploy the ./deploy folder instead.");
}
console.log("Standalone bundle ready in ./deploy (start command: node server.js)");
