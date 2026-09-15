import { Injectable } from "@nestjs/common";
import * as argon2 from "argon2";

// OWASP-baseline argon2id parameters: 64 MiB memory, 3 iterations,
// 4-way parallelism. Tuned for a server-side login path, not a
// resource-constrained device.
const ARGON2_OPTIONS: argon2.Options & { raw?: false } = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

@Injectable()
export class PasswordService {
  async hash(plainPassword: string): Promise<string> {
    return argon2.hash(plainPassword, ARGON2_OPTIONS);
  }

  async verify(passwordHash: string, plainPassword: string): Promise<boolean> {
    return argon2.verify(passwordHash, plainPassword);
  }
}
