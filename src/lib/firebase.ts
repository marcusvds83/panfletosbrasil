import { initializeApp, getApps, type App } from 'firebase/app'
import { getFirestore, type Firestore } from 'firebase/firestore'
import { getAuth, type Auth } from 'firebase/auth'

let _app: App | null = null
let _db: Firestore | null = null
let _auth: Auth | null = null
let _configured = false
let _initAttempted = false

/** Returns true when all required NEXT_PUBLIC_FIREBASE_* env vars are present */
export function isFirebaseConfigured(): boolean {
  // Força init se ainda não tentou
  if (!_initAttempted) initFirebase()
  return _configured
}

function initFirebase() {
  if (_initAttempted) return
  _initAttempted = true

  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID

  if (!apiKey || !authDomain || !projectId || apiKey === 'your-api-key') {
    console.warn('[Firebase] Não configurado. Defina as variáveis NEXT_PUBLIC_FIREBASE_* no Render.')
    return
  }

  try {
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
    console.log('[Firebase] Inicializado com sucesso. Project:', projectId)
  } catch (e) {
    console.error('[Firebase] Erro ao inicializar:', e)
    _configured = false
  }
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

/**
 * Eager exports — chama initFirebase() no momento do import.
 * Diferente do Proxy, exporta a instância REAL do Firestore (ou null),
 * para que collection(db, 'usuarios') funcione corretamente.
 */
initFirebase()

export const firebaseApp = _app
export const firestore = _db as Firestore
export const firebaseAuth = _auth as Auth
