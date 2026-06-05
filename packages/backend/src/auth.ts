import { compare, hash } from "bcryptjs";

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return compare(password, passwordHash);
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, 12);
}
