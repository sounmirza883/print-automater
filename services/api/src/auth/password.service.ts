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

/** Fix wave 1: `users.password_hash` for an account that exists but whose person has not
 * chosen a password yet -- the owner an admin names when creating a business
 * (AdminService.createBusiness). The column is NOT NULL, so this marker stands in for
 * "none". It can never match anything: `verify` refuses it before argon2 is reached (every
 * real hash starts with `$argon2`, and the leading `!` is the conventional "unusable
 * password" prefix), so such an account cannot sign in until it is activated through
 * the emailed code (ShopStaffInvitesService.activateInvitedAccount), which is also the
 * ONLY path allowed to replace this marker. */
export const PASSWORD_NOT_SET = "!password-not-set";

@Injectable()
export class PasswordService {
  async hash(plainPassword: string): Promise<string> {
    return argon2.hash(plainPassword, ARGON2_OPTIONS);
  }

  async verify(passwordHash: string, plainPassword: string): Promise<boolean> {
    if (!this.isPasswordSet(passwordHash)) {
      return false;
    }
    return argon2.verify(passwordHash, plainPassword);
  }

  /** False only for PASSWORD_NOT_SET: an account still waiting for its person to choose one. */
  isPasswordSet(passwordHash: string): boolean {
    return passwordHash !== PASSWORD_NOT_SET;
  }
}
