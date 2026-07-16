import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * API de contato / suporte
 * Mercado logado: preenche dados do mercado automaticamente
 * Consumidor logado: identifica como consumidor
 * Mensagens ficam armazenadas em memória e podem ser vistas pelo admin via GET
 */

const mensagens: Array<{
  id: string
  tipo: 'mercado' | 'consumidor'
  nome: string
  email: string
  categoria: string
  assunto: string
  mensagem: string
  mercadoNome?: string | null
  criadoEm: string
}> = []

function uid() {
  return 'msg_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    const body = await req.json()
    const { categoria, assunto, mensagem, nome, email } = body

    if (!categoria || !assunto || !mensagem) {
      return NextResponse.json({ erro: 'Categoria, assunto e mensagem são obrigatórios' }, { status: 400 })
    }
    if (mensagem.trim().length < 10) {
      return NextResponse.json({ erro: 'A mensagem deve ter pelo menos 10 caracteres' }, { status: 400 })
    }

    let tipo: 'mercado' | 'consumidor' = 'consumidor'
    let msgNome = nome || ''
    let msgEmail = email || ''
    let mercadoNome: string | null = null

    if (session?.tipo === 'mercado') {
      tipo = 'mercado'
      const mercado = await db.mercado.findUnique({ where: { id: session.id } })
      if (mercado) {
        msgNome = (mercado as any).nome || session.nome || ''
        msgEmail = (mercado as any).emailLogin || session.email || ''
        mercadoNome = (mercado as any).nome || null
      }
    } else if (session?.tipo === 'usuario') {
      tipo = 'consumidor'
      msgNome = session.nome || nome || ''
      msgEmail = session.email || email || ''
    }

    if (!msgNome || !msgEmail) {
      return NextResponse.json({ erro: 'Nome e e-mail são obrigatórios' }, { status: 400 })
    }

    const msg = {
      id: uid(),
      tipo,
      nome: msgNome,
      email: msgEmail,
      categoria,
      assunto,
      mensagem: mensagem.trim(),
      mercadoNome,
      criadoEm: new Date().toISOString(),
    }
    mensagens.push(msg)

    // Tenta enviar e-mail (usa defaults do email.ts se env vars nao definidas)
    const SMTP_HOST = process.env.SMTP_HOST || 'mail.3codenexus.com.br'
    const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465', 10)
    const SMTP_USER = process.env.SMTP_USER || 'contato@3codenexus.com.br'
    const SMTP_PASS = process.env.SMTP_PASS || 'kermit051326'
    const SMTP_FROM = process.env.SMTP_FROM || 'EncarteBrasil <contato@3codenexus.com.br>'

    console.log(`[contato] enviando email via ${SMTP_HOST}:${SMTP_PORT} user=${SMTP_USER}`)
    try {
      const nodemailer = await import('nodemailer')
      const transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
        connectionTimeout: 10_000,
        greetingTimeout: 5_000,
        socketTimeout: 15_000,
      })
      const tipoLabel = tipo === 'mercado' ? '[MERCADO]' : '[CONSUMIDOR]'
      const mercadoInfo = mercadoNome ? ` (${mercadoNome})` : ''
      const info = await transporter.sendMail({
        from: SMTP_FROM,
        to: process.env.CONTATO_EMAIL || 'contato@3codenexus.com.br',
        subject: `${tipoLabel}${mercadoInfo} ${categoria}: ${assunto}`,
        text: [
          `Tipo: ${tipo.toUpperCase()}${mercadoInfo}`,
          `Nome: ${msgNome}`,
          `E-mail: ${msgEmail}`,
          `Categoria: ${categoria}`,
          `Assunto: ${assunto}`,
          '', msg.mensagem, '',
          `Enviado em: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
        ].join('\n'),
      })
      console.log(`[contato] email enviado: ${info.messageId}`)
    } catch (emailErr: any) {
      console.error(`[contato] erro ao enviar e-mail: ${emailErr?.message || emailErr}`)
    }

    return NextResponse.json({ ok: true, mensagem: 'Mensagem enviada com sucesso!' })
  } catch (e) {
    console.error('[contato] erro:', e)
    return NextResponse.json({ erro: 'Erro ao enviar mensagem' }, { status: 500 })
  }
}

export async function GET() {
  try {
    const session = await getSession()
    if (!session || session.tipo !== 'admin') {
      return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
    }
    return NextResponse.json({
      mensagens: mensagens.sort((a, b) => b.criadoEm.localeCompare(a.criadoEm)),
      total: mensagens.length,
    })
  } catch {
    return NextResponse.json({ erro: 'Erro interno' }, { status: 500 })
  }
}