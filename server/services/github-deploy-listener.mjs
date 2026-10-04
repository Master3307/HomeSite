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
const deployDirectory = "/opt/homesite-api";
const maxBodyBytes = 1024 * 1024; // 1 MiB

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

function startDeployment(commit, deliveryId) {
  deploymentRunning = true;

  const deployment = spawn(deployScript, [], {
    cwd: deployDirectory,
    detached: false,
    stdio: "inherit",
    shell: false,
    env: process.env,
  });

  deployment.once("error", (error) => {
    deploymentRunning = false;
    console.error(
      `Deployment failed to start (delivery=${deliveryId}, commit=${commit}):`,
      error,
    );
  });

  deployment.once("exit", (code, signal) => {
    deploymentRunning = false;

    console.log(
      `Deployment finished: delivery=${deliveryId}, commit=${commit}, code=${code ?? "null"}, signal=${signal ?? "none"}`,
    );
  });
}

const server = http.createServer((request, response) => {
  if (request.method !== "POST" || request.url !== endpoint) {
    respond(response, 404, { error: "Not found" });
    return;
  }

  const contentLength = Number(request.headers["content-length"] ?? 0);

  if (
    !Number.isFinite(contentLength) ||
    contentLength < 0 ||
    contentLength > maxBodyBytes
  ) {
    respond(response, 413, { error: "Payload too large" });
    request.resume();
    return;
  }

  const chunks = [];
  let receivedBytes = 0;
  let rejected = false;

  request.on("data", (chunk) => {
    if (rejected) {
      return;
    }

    receivedBytes += chunk.length;

    if (receivedBytes > maxBodyBytes) {
      rejected = true;
      respond(response, 413, { error: "Payload too large" });
      request.destroy();
      return;
    }

    chunks.push(chunk);
  });

  request.on("error", (error) => {
    console.error("Webhook request error:", error.message);
  });

  request.on("end", () => {
    if (rejected || response.writableEnded) {
      return;
    }

    const rawBody = Buffer.concat(chunks);
    const deliveryId = request.headers["x-github-delivery"] ?? "unknown";

    if (!hasValidSignature(rawBody, request.headers["x-hub-signature-256"])) {
      console.warn(`Rejected invalid signature: delivery=${deliveryId}`);
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
      console.warn(
        `Rejected unexpected repository: delivery=${deliveryId}, repository=${payload.repository?.full_name ?? "unknown"}`,
      );
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

    if (!/^[a-f0-9]{40}$/i.test(payload.after ?? "")) {
      respond(response, 400, { error: "Invalid commit SHA" });
      return;
    }

    if (deploymentRunning) {
      console.warn(
        `Skipped overlapping deployment: delivery=${deliveryId}, commit=${payload.after}`,
      );
      respond(response, 409, { error: "Deployment already running" });
      return;
    }

    respond(response, 202, {
      status: "Deployment started",
      commit: payload.after,
    });

    console.log(
      `Starting deployment: delivery=${deliveryId}, commit=${payload.after}`,
    );

    startDeployment(payload.after, deliveryId);
  });
});

server.listen(port, host, () => {
  console.log(`GitHub hook listening at http://${host}:${port}${endpoint}`);
});
