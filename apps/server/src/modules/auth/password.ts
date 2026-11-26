import { hash, verify } from '@node-rs/argon2'

const options = { memoryCost: 19_456, timeCost: 2, parallelism: 1 }

export const hashPassword = (password: string) => hash(password, options)

export const verifyPassword = ({ hash: stored, password }: { hash: string; password: string }) =>
  verify(stored, password)
