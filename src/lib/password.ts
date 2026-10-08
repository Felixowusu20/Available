import { hash, verify } from "@node-rs/argon2";

// argon2id with the library defaults (OWASP-recommended class of parameters).
export const hashPassword = (plain: string) => hash(plain);

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}

// A real hash of a throwaway string, verified against when the user does not exist
// so login timing does not reveal which emails are registered.
let dummy: Promise<string> | undefined;
export function dummyVerify(plain: string): Promise<boolean> {
  dummy ??= hash("not-a-real-password");
  return dummy.then((h) => verifyPassword(h, plain));
}
