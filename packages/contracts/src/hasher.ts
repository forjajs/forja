/**
 * Contract: Hasher
 * Fulfilled by: any password-hashing implementation (bcrypt, argon2, scrypt...).
 * The core and every engine depend on this shape only — never on a concrete lib.
 */
export interface Hasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, hash: string): Promise<boolean>;
}

export const HASHER_METHODS: (keyof Hasher)[] = ["hash", "verify"];
