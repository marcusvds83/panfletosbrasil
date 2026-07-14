import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sessionCookie, type SessionData } from '@/lib/auth'

/**
 * Cadastro de Consumidor (PF) por e-mail/senha via Firebase Auth.
 * O Firebase Auth cria a conta; nós criamos o registro em `usuarios` e
 * devolvemos a sessão.
 *
 * Body: { email, senha, nome? }
 */
export async function POST(req: NextRequest) {
  try {
    const { email, senha, nome } = await req.json()
    if (!email || !senha) {
      return NextResponse.json({ erro: 'Preencha e-mail e senha' }, { status: 400 })
    }
    if (senha.length < 6) {
      return NextResponse.json({ erro: 'Senha deve ter no mínimo 6 caracteres' }, { status: 400 })
    }

    // Cria a conta no Firebase Auth via REST API pública
    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { erro: 'Firebase não configurado. Cadastro indisponível.' },
        { status: 503 },
      )
    }

    const firebaseRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: senha, returnSecureToken: true }),
      },
    )

    const fbData = await firebaseRes.json()
    if (!firebaseRes.ok) {
      const msg =
        fbData?.error?.message === 'EMAIL_EXISTS'
          ? 'E-mail já cadastrado. Faça login.'
          : fbData?.error?.message || 'Erro ao cadastrar no Firebase'
      return NextResponse.json({ erro: msg }, { status: 400 })
    }

    const uid = fbData.localId
    if (!uid) {
      return NextResponse.json({ erro: 'Erro inesperado no Firebase' }, { status: 500 })
    }

    // Cria registro em `usuarios`
    let usuario: any = null
    try {
      const existente = await db.usuario.findUnique({ where: { email } })
      if (existente) {
        usuario = existente
      } else {
        usuario = await db.usuario.create({
          data: {
            email,
            firebaseUid: uid,
            nome: nome || null,
            photoURL: null,
            provider: 'email',
            criadoEm: new Date().toISOString(),
          },
        })
      }
    } catch (e) {
      console.error('[cadastro] erro ao criar registro usuario:', e)
    }

    const data: SessionData = {
      tipo: 'usuario',
      email,
      id: usuario?.id || uid,
      nome: nome || undefined,
      photoURL: null,
      provider: 'email',
    }
    const cookie = sessionCookie(data)
    const res = NextResponse.json({ ok: true, tipo: 'usuario', ...data })
    res.cookies.set(cookie)
    return res
  } catch (e) {
    console.error('[cadastro] erro:', e)
    return NextResponse.json({ erro: 'Erro interno' }, { status: 500 })
  }
}
