import { initializeApp, getApps, type App } from 'firebase/app'
import { getFirestore, type Firestore } from 'firebase/firestore'
import { getAuth, type Auth } from 'firebase/auth'

let _app: App | null = null
let _db: Firestore | null = null
let _auth: Auth | null = null
let _configured = false

/** Returns true when all required NEXT_PUBLIC_FIREBASE_* env vars are present */
export function isFirebaseConfigured(): boolean {
  return _configured
}

function initFirebase() {
  if (_app) return

  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID

  if (!apiKey || !authDomain || !projectId || apiKey === 'your-api-key') {
    console.warn('[Firebase] Não configurado. Defina as variáveis NEXT_PUBLIC_FIREBASE_* no Render.')
    return
  }

  _configured = true

  _app = getApps().length === 0
    ? initializeApp({
        apiKey,
        authDomain,
        projectId,
        storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
        messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
        appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '',
      })
    : getApps()[0]

  _db = getFirestore(_app)
  _auth = getAuth(_app)
}

export function getFirebaseApp(): App | null {
  initFirebase()
  return _app
}

export function getFirebaseDb(): Firestore | null {
  initFirebase()
  return _db
}

export function getFirebaseAuth(): Auth | null {
  initFirebase()
  return _auth
}

// Lazy exports - only init when actually accessed
export const firebaseApp = new Proxy({} as App, {
  get(_, prop) {
    const app = getFirebaseApp()
    return app ? (app as any)[prop] : undefined
  },
})

export const firestore = new Proxy({} as Firestore, {
  get(_, prop) {
    const db = getFirebaseDb()
    return db ? (db as any)[prop] : undefined
  },
})

export const firebaseAuth = new Proxy({} as Auth, {
  get(_, prop) {
    const auth = getFirebaseAuth()
    return auth ? (auth as any)[prop] : undefined
  },
})