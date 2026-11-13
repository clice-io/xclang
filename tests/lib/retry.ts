/// A command run again when it fails for the network: GitHub's 5xx (release
/// downloads, its API), timeouts, connections reset. A download of the
/// workflows goes through it:
///
///   node tests/lib/retry.ts <command> [args...]
///
/// The command's output is passed through as it comes. A failure whose
/// output names no transient cause (a 404, a missing file, a test that
/// fails) ends it at once, with the command's exit status; a transient one
/// runs the command again after 15 s, then 45 s, 90 s and 180 s: five
/// tries in about six minutes, longer than GitHub's usual blips. A command
/// run again must be one that can be: a download that overwrites
/// (gh release download --clobber), an API call that reads or sets.

import { spawn } from "node:child_process";
import { TRANSIENT, WAITS } from "./net.ts";

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("usage: node tests/lib/retry.ts <command> [args...]");
  process.exit(2);
}

/// A reader that stops early (`| head -n 1`) closes the pipe: what is
/// left to pass on goes nowhere, and the command's status still counts.
process.stdout.on("error", (e: NodeJS.ErrnoException) => { if (e.code !== "EPIPE") throw e; });

for (let attempt = 1; ; attempt++) {
  const { status, output } = await new Promise<{ status: number; output: string }>((resolve) => {
    const child = spawn(command, args, { stdio: ["inherit", "pipe", "pipe"], shell: false });
    let output = "";
    child.stdout.on("data", (d: Buffer) => { process.stdout.write(d); output += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { process.stderr.write(d); output += d.toString(); });
    child.on("error", (e) => resolve({ status: 127, output: String(e) }));
    child.on("close", (code) => resolve({ status: code ?? 1, output }));
  });
  if (status === 0) process.exit(0);
  const wait = WAITS[attempt - 1];
  if (wait === undefined || !TRANSIENT.test(output)) process.exit(status);
  console.error(`::warning::${command} failed for the network (try ${attempt} of ${WAITS.length + 1}); again in ${wait} s`);
  await new Promise((resolve) => setTimeout(resolve, wait * 1000));
}
