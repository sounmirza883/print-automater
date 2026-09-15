import { Socket } from "node:net";
import { Inject, Injectable } from "@nestjs/common";
import type { WorkerEnv } from "@print-automated/config";
import { WORKER_ENV } from "../config/config.module.js";
import { DocumentRejectedError } from "./document-rejected.error.js";
import { RejectionReason } from "./rejection-reason.js";

const CHUNK_SIZE = 1024 * 1024; // 1MB, well under clamd's typical StreamMaxLength
const SCAN_TIMEOUT_MS = 60_000;

/** §86, feature-flagged (CLAMAV_ENABLED, default true) so pilot
 * deployments can disable it without touching the pipeline. Talks to
 * clamd's INSTREAM protocol directly over a raw TCP socket -- not
 * through the `clamscan` npm package, whose scanStream was empirically
 * proven NOT to detect a real EICAR test string against this exact
 * clamd version (verified three ways: `clamdscan` inside the container
 * correctly flags it, a hand-rolled INSTREAM client correctly flags
 * it, but clamscan's scanStream and isInfected both report "OK" for
 * the identical bytes -- a real bug in that library, not a
 * configuration or protocol misunderstanding on this side).
 *
 * Protocol (ClamAV's documented INSTREAM command): send "zINSTREAM\0",
 * then the payload as 4-byte-big-endian-length-prefixed chunks, then a
 * zero-length chunk to signal end of stream. Response is a single line,
 * either "stream: OK" or "stream: <signature name> FOUND". */
@Injectable()
export class ClamavScannerService {
  constructor(@Inject(WORKER_ENV) private readonly env: WorkerEnv) {}

  async assertClean(buffer: Buffer): Promise<void> {
    if (!this.env.CLAMAV_ENABLED) {
      return;
    }

    const response = await this.scan(buffer);
    if (response.includes("FOUND")) {
      throw new DocumentRejectedError(RejectionReason.MALWARE_DETECTED);
    }
    if (!response.includes("OK")) {
      throw new Error(`Unexpected ClamAV response: ${response}`);
    }
  }

  private scan(buffer: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = new Socket();
      let response = "";

      socket.setTimeout(SCAN_TIMEOUT_MS);
      socket.on("timeout", () => {
        socket.destroy();
        reject(new Error("ClamAV scan timed out."));
      });
      socket.on("error", reject);
      socket.on("data", (chunk: Buffer) => {
        response += chunk.toString("utf8");
      });
      socket.on("end", () => resolve(response.trim()));

      socket.connect(this.env.CLAMAV_PORT, this.env.CLAMAV_HOST, () => {
        socket.write("zINSTREAM\0");
        for (let offset = 0; offset < buffer.length; offset += CHUNK_SIZE) {
          const chunk = buffer.subarray(offset, offset + CHUNK_SIZE);
          const lengthPrefix = Buffer.alloc(4);
          lengthPrefix.writeUInt32BE(chunk.length, 0);
          socket.write(Buffer.concat([lengthPrefix, chunk]));
        }
        socket.write(Buffer.alloc(4)); // zero-length chunk: end of stream
      });
    });
  }
}
