import fs from 'node:fs/promises'
import path from 'node:path'
import { webcrypto } from 'node:crypto'

const PASSWORD = process.env.QUERY_PASSWORD
if (!PASSWORD) {
  throw new Error('QUERY_PASSWORD is required.')
}

const QUERIES_DIR = path.resolve(process.cwd(), 'src', 'queries')
const OUTPUT_FILE = path.join(QUERIES_DIR, 'queries.encrypted.json')
const ITERATIONS = 210000
const SALT_LEN = 16
const IV_LEN = 12

const encoder = new TextEncoder()
const base64 = (bytes) => Buffer.from(bytes).toString('base64')

const deriveKey = async (password, salt) => {
  const keyMaterial = await webcrypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return webcrypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  )
}

const encryptText = async (text, password) => {
  const salt = webcrypto.getRandomValues(new Uint8Array(SALT_LEN))
  const iv = webcrypto.getRandomValues(new Uint8Array(IV_LEN))
  const key = await deriveKey(password, salt)
  const encrypted = await webcrypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(text)
  )
  return {
    salt: base64(salt),
    iv: base64(iv),
    data: base64(new Uint8Array(encrypted)),
  }
}

const buildEncryptedQueries = async () => {
  const files = (await fs.readdir(QUERIES_DIR)).filter((file) => file.endsWith('.rq'))
  if (!files.length) {
    throw new Error('No .rq files found.')
  }
  const queries = []
  for (const file of files) {
    const fullPath = path.join(QUERIES_DIR, file)
    const content = await fs.readFile(fullPath, 'utf8')
    const { salt, iv, data } = await encryptText(content, PASSWORD)
    queries.push({
      name: file,
      label: file.replace(/\.rq$/i, ''),
      salt,
      iv,
      data,
    })
  }
  queries.sort((a, b) => a.name.localeCompare(b.name))
  return {
    version: 1,
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: ITERATIONS,
    },
    cipher: {
      name: 'AES-GCM',
      ivLength: IV_LEN,
      keyLength: 256,
    },
    queries,
  }
}

const encrypted = await buildEncryptedQueries()
await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(encrypted, null, 2)}\n`, 'utf8')
console.log(`Wrote ${encrypted.queries.length} encrypted queries to ${OUTPUT_FILE}`)
