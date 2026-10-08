import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buffer } from "node:stream/consumers";

import { describe, expect, it } from "vitest";

import {
  ArtifactReaderFailure,
  type ArtifactEntry,
} from "../../../src/artifacts/ArtifactReader.js";
import { DirectoryArtifactReader } from "../../../src/artifacts/DirectoryArtifactReader.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

describe("DirectoryArtifactReader.open", () => {
  it("opens regular files from directory reader and reads their contents", async () => {
    const root = await createTestTempDirectory("rea-dir-reader-open-");
    const filePath = join(root, "sample.txt");
    await writeFile(filePath, "test payload\n");
    const reader = new DirectoryArtifactReader(root);
    try {
      const entries: ArtifactEntry[] = [];
      for await (const entry of reader.entries()) {
        entries.push(entry);
      }
      const sampleEntry = entries.find((e) => e.path === "sample.txt");
      expect(sampleEntry).toBeDefined();
      expect(sampleEntry?.kind).toBe("file");
      expect(sampleEntry?.sourceIdentity).toBeDefined();

      const stream = await reader.open(sampleEntry!);
      const content = (await buffer(stream)).toString("utf8");
      expect(content).toBe("test payload\n");
    } finally {
      await reader.close();
    }
  });

  it("rejects open if inode does not match", async () => {
    const root = await createTestTempDirectory("rea-dir-reader-open-");
    const filePath = join(root, "sample.txt");
    await writeFile(filePath, "test payload\n");
    const reader = new DirectoryArtifactReader(root);
    try {
      const entries: ArtifactEntry[] = [];
      for await (const entry of reader.entries()) {
        entries.push(entry);
      }
      const sampleEntry = entries.find((e) => e.path === "sample.txt");
      expect(sampleEntry).toBeDefined();

      const tamperedEntry: ArtifactEntry = {
        ...sampleEntry!,
        sourceIdentity: {
          device: sampleEntry!.sourceIdentity!.device,
          inode: sampleEntry!.sourceIdentity!.inode + 999999,
        },
      };

      await expect(reader.open(tamperedEntry)).rejects.toThrow(
        ArtifactReaderFailure,
      );
      await expect(reader.open(tamperedEntry)).rejects.toMatchObject({
        reason: "integrity",
      });
    } finally {
      await reader.close();
    }
  });

  it("allows open when entry device is 0 and inode matches", async () => {
    const root = await createTestTempDirectory("rea-dir-reader-open-");
    const filePath = join(root, "sample.txt");
    await writeFile(filePath, "windows lstat compatibility\n");
    const reader = new DirectoryArtifactReader(root);
    try {
      let fileEntry: ArtifactEntry | undefined;
      for await (const entry of reader.entries()) {
        if (entry.path === "sample.txt") fileEntry = entry;
      }
      expect(fileEntry).toBeDefined();

      // On Windows, lstat reports dev as 0 while handle.stat() reports volume serial number.
      // Simulating device = 0 verifies this does not trigger a false-positive integrity failure.
      const entryWithZeroDev: ArtifactEntry = {
        ...fileEntry!,
        sourceIdentity: {
          device: 0,
          inode: fileEntry!.sourceIdentity!.inode,
        },
      };

      const stream = await reader.open(entryWithZeroDev);
      const content = (await buffer(stream)).toString("utf8");
      expect(content).toBe("windows lstat compatibility\n");
    } finally {
      await reader.close();
    }
  });

  it("rejects open if entry kind is not file", async () => {
    const root = await createTestTempDirectory("rea-dir-reader-open-");
    const reader = new DirectoryArtifactReader(root);
    try {
      const nonFileEntry: ArtifactEntry = {
        path: "some-dir",
        kind: "directory",
        declaredSize: null,
        compressedSize: null,
        executable: false,
        encrypted: false,
        byteOffset: null,
        declaredSha256: null,
        unpacked: false,
        limitations: [],
        adapterKey: root,
      };

      await expect(reader.open(nonFileEntry)).rejects.toThrow(
        ArtifactReaderFailure,
      );
      await expect(reader.open(nonFileEntry)).rejects.toMatchObject({
        reason: "format",
      });
    } finally {
      await reader.close();
    }
  });
});
