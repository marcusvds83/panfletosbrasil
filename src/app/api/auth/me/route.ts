import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { cookies } from 'next/headers'

export async function GET(req: NextRequest) {
  try {
    // Debug: log cookie presence
    const cookieStore = await cookies()
    const raw = cookieStore.get('eb_session')?.value
    if (!raw) {
      console.log('[auth/me] sem cookie eb_session')
      return NextResponse.json({ logado: false }, { status: 401 })
    }
    console.log(`[auth/me] cookie encontrado, tipo=${(() => { try { return JSON.parse(raw).tipo } catch { return 'parse-erro' } })()}`)

    const session = await getSession()
    if (!session) {
      console.log('[auth/me] getSession retornou null (cookie invalido ou usuario nao encontrado no DB)')
      return NextResponse.json({ logado: false }, { status: 401 })
    }
    console.log(`[auth/me] sessao valida: tipo=${session.tipo} id=${session.id} email=${session.email}`)
    return NextResponse.json({ logado: true, ...session })
  } catch (e) {
    console.error('[auth/me] erro:', e)
    return NextResponse.json({ erro: 'Erro interno' }, { status: 500 })
  }
}
