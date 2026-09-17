import { generateKeyPairSync, createPrivateKey, sign } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'

export type Identity = { relay: string; publicKey: string; privateKey: string; machine?: string; name: string }

const directory = process.env.QUESTGIVER_STATE ?? join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local/state'), 'questgiver')
const file = join(directory, 'machine.json')

/**
 * The machine's key pair is made here and never leaves: the relay gets the public half, and every
 * connection signs a nonce, so nothing the relay holds can impersonate this computer or expire.
 */
export function loadIdentity(relay: string): Identity {
  if (existsSync(file)) {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as Identity
    if (!relay || saved.relay === relay) return saved
    throw new Error(`This computer is linked to ${saved.relay}, not ${relay}. Remove ${file} to link it elsewhere.`)
  }
  if (!relay) throw new Error('Name the site the first time: questgiver link https://<site>')
  const pair = generateKeyPairSync('ed25519')
  const publicKey = pair.publicKey.export({ format: 'jwk' }).x!
  const identity: Identity = { relay, publicKey, privateKey: pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(), name: hostname() }
  saveIdentity(identity)
  return identity
}

export function saveIdentity(identity: Identity) {
  mkdirSync(directory, { recursive: true })
  writeFileSync(file, JSON.stringify(identity, null, 2), { mode: 0o600 })
}

export const signWith = (identity: Identity, message: Uint8Array) => sign(null, message, createPrivateKey(identity.privateKey)).toString('base64url')
