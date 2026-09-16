import { readFile } from "node:fs/promises";

const expectedProjectId = "appgprj_6a5aabe71a6081918018d373a3c5716f";
const externalWorkerName = "antikrizis-assessment-card";
const hosting = JSON.parse(
  await readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
);

if (process.env.ANTIKRIZIS_EXTERNAL_DEPLOY === "1") {
  const wrangler = JSON.parse(
    await readFile(new URL("../wrangler.anti-krizis.jsonc", import.meta.url), "utf8"),
  );
  if (wrangler.name !== externalWorkerName) {
    throw new Error(
      "Build stopped: the independent Anti-Krizis Worker target is not configured.",
    );
  }
  process.exit(0);
}

if (hosting.project_id !== expectedProjectId) {
  throw new Error(
    "Build stopped: Assessment Card is not connected to its canonical Site. " +
    "This guard prevents publishing the Bitrix tool without its hosted webhook.",
  );
}
