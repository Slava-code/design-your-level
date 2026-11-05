import "server-only";
import { randomBytes } from "node:crypto";

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
/** 12-char random id (unguessable; ~60 bits). */
export function newId(): string {
  const b = randomBytes(12);
  let s = "";
  for (let i = 0; i < 12; i++) s += ALPHABET[b[i] % ALPHABET.length];
  return s;
}
