import http from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";

const host = "127.0.0.1";
const port = 9080;
const endpoint = "/github";

const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
const expectedRepository = "Master3307/HomeSite";
const expectedRef = "refs/heads/master";
const deployScript = "/opt/homesite-api/scripts/deploy.sh";

if (!webhookSecret) {
  throw new Error("GITHUB_WEBHOOK_SECRET is not set.");
}

let deploymentRunning = false;

function respond(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });

  response.end(JSON.stringify(payload));
}

function hasValidSignature(rawBody, receivedSignature) {
  if (typeof receivedSignature !== "string") {
    return false;
  }

  const expectedSignature = `sha256=${createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex")}`;

  const expected = Buffer.from(expectedSignature, "utf8");
  const received = Buffer.from(receivedSignature, "utf8");

  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}

const server = http.createServer((request, response) => {
  if (request.method !== "POST" || request.url !== endpoint) {
    respond(response, 404, { error: "Not found" });
    return;
  }

  const chunks = [];

  request.on("data", (chunk) => {
    chunks.push(chunk);
  });

  request.on("end", () => {
    const rawBody = Buffer.concat(chunks);

    if (!hasValidSignature(rawBody, request.headers["x-hub-signature-256"])) {
      respond(response, 401, { error: "Invalid signature" });
      return;
    }

    if (request.headers["x-github-event"] !== "push") {
      respond(response, 202, { status: "Ignored non-push event" });
      return;
    }

    let payload;

    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      respond(response, 400, { error: "Invalid JSON" });
      return;
    }

    if (payload.repository?.full_name !== expectedRepository) {
      respond(response, 403, { error: "Unexpected repository" });
      return;
    }

    if (payload.ref !== expectedRef) {
      respond(response, 202, {
        status: "Ignored push outside master",
        ref: payload.ref ?? null,
      });
      return;
    }

    if (!/^[a-f0-9]{40}$/.test(payload.after ?? "")) {
      respond(response, 400, { error: "Invalid commit SHA" });
      return;
    }

    if (deploymentRunning) {
      respond(response, 409, { error: "Deployment already running" });
      return;
    }

    deploymentRunning = true;

    const deployment = spawn(deployScript, [], {
      cwd: "/opt/homesite-api",
      detached: false,
      stdio: "ignore",
      shell: false,
      env: process.env,
    });

    deployment.once("error", (error) => {
      deploymentRunning = false;
      console.error("Failed to start deployment:", error);
    });

    deployment.once("exit", (code, signal) => {
      deploymentRunning = false;
      console.log(
        `Deployment finished: code=${code ?? "null"}, signal=${signal ?? "none"}`,
      );
    });

    respond(response, 202, {
      status: "Deployment started",
      commit: payload.after,
    });
  });
});

server.listen(port, host, () => {
  console.log(`GitHub hook listening at http://${host}:${port}${endpoint}`);
});
