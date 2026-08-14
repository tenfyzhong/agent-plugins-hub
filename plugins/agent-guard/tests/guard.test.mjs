import assert from "node:assert/strict";
import test from "node:test";

import { dangerousCommandReason } from "../lib/guard.mjs";

const blockedCommands = [
  ["rm -rf /tmp/project", "forced recursive deletion"],
  ["sudo rm -fr -- /var/tmp/cache", "forced recursive deletion"],
  ["env FOO=bar command rm --recursive --force ./build", "forced recursive deletion"],
  ["bash -lc 'rm -rf /tmp/project'", "forced recursive deletion"],
  ["echo \"$(rm -rf /tmp/project)\"", "forced recursive deletion"],
  ["eval 'git reset --hard HEAD'", "destructive git reset"],
  ["pass show production/database", "credential-store access"],
  ["git reset --hard HEAD~1", "destructive git reset"],
  ["git clean -fdx", "destructive git clean"],
  ["dd if=/dev/zero of=/dev/disk4", "raw device overwrite"],
  ["mkfs.ext4 /dev/sdb1", "filesystem formatting"],
  ["shutdown -h now", "host shutdown"],
];

for (const [command, expectedReason] of blockedCommands) {
  test(`blocks ${command}`, () => {
    assert.match(dangerousCommandReason(command) ?? "", new RegExp(expectedReason));
  });
}

const allowedCommands = [
  "rm ./build/output.txt",
  "rm -r ./build",
  "git reset --soft HEAD~1",
  "git clean -nfdx",
  "echo 'rm -rf /tmp/project'",
  "printf '%s\\n' pass",
  "go test ./...",
];

for (const command of allowedCommands) {
  test(`allows ${command}`, () => {
    assert.equal(dangerousCommandReason(command), undefined);
  });
}
