#!/usr/bin/env node

import { TSUKURU_ISIC_INDUSTRY_ACTORS } from "../appview/tsukuru-tsukr8u0/src/isic-industry-actors.mjs";

const PDS_HOST = process.env.PDS_HOST ?? "https://atproto.etzhayyim.com";
const APP_DID = process.env.TSUKURU_APP_DID ?? "did:web:tsukuru.etzhayyim.com";
const TOKEN = process.env.etzhayyim_TOKEN;
const DRY_RUN = process.argv.includes("--dry-run");
const SECTION = getArg("--section");

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

if (!TOKEN && !DRY_RUN) {
  console.error("error: etzhayyim_TOKEN env var is required unless --dry-run is used.");
  console.error("  export etzhayyim_TOKEN=$(etzhayyim agent-token --lxm com.atproto.identity.create --did did:web:tsukuru.etzhayyim.com)");
  process.exit(1);
}

const actors = TSUKURU_ISIC_INDUSTRY_ACTORS.filter((actor) => !SECTION || actor.sectionCode === SECTION.toUpperCase());

async function xrpc(method, body) {
  if (DRY_RUN) {
    return { ok: true, dryRun: true, method, body };
  }
  const response = await fetch(`${PDS_HOST}/xrpc/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${method} ${response.status}: ${text.slice(0, 200)}`);
  }
  return response.json();
}

async function registerActor(actor) {
  await xrpc("com.atproto.identity.create", {
    path: actor.actorPath,
    hostDid: APP_DID,
    follow: true,
    document: {
      displayName: `Tsukuru ${actor.displayName ?? actor.label}`,
      description: `${actor.label} BPMN actor (${actor.bpmnProcessId})`,
      sectionCode: actor.sectionCode,
      bpmnProcessId: actor.bpmnProcessId,
      industryCodes: actor.industryCodes,
    },
  });
  process.stdout.write(`  ${actor.sectionCode} ${actor.actorDid} ${actor.bpmnProcessId}\n`);
}

async function main() {
  console.log(`Registering ${actors.length} tsukuru ISIC industry actors`);
  console.log(`  PDS: ${PDS_HOST}`);
  console.log(`  Controller DID: ${APP_DID}`);
  console.log(`  Dry run: ${DRY_RUN}`);
  for (const actor of actors) {
    await registerActor(actor);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
