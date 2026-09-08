import mcs from "node-mcstatus";

const host = "nigelserver2026.aternos.me";
const port = 25565;

try {
  const result = await mcs.statusJava(host, port, {
    query: false,
  });

  console.dir(result, { depth: null });
} catch (error) {
  console.error("Could not call mcstatus.io:", error);
}
