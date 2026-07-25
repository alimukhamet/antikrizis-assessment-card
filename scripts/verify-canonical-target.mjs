import { readFile } from "node:fs/promises";

const expectedProjectId = "appgprj_6a5aabe71a6081918018d373a3c5716f";
const hosting = JSON.parse(
  await readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
);

if (hosting.project_id !== expectedProjectId) {
  throw new Error(
    "Build stopped: Assessment Card is not connected to its canonical Site. " +
    "This guard prevents publishing the Bitrix tool without its hosted webhook.",
  );
}
