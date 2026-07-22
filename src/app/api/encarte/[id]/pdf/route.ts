import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { readFile, writeFile, mkdir } from 'fs/promises'
import path from 'path'

/**
 * GET /api/encarte/[id]/pdf — serve o PDF do encarte para visualização.
 *
 * Estratégia de recuperação:
 * 1. Tenta ler do /tmp/uploads/ (rápido, efêmero)
 * 2. Se não existir (após deploy), reconstrói a partir do pdfBase64 no Firestore
 * 3. Se não tiver base64, retorna 404
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params

    // Busca o encarte percorrendo mercados
    const mercados = await db.mercado.findMany()
    let encarte: any = null
    for (const m of mercados) {
      const detail: any = await db.mercado.findUniqueWithRelations(m.id)
      const found = detail?.encartes?.find((e: any) => e.id === id)
      if (found) {
        encarte = found
        break
      }
    }

    if (!encarte) {
      return NextResponse.json({ erro: 'Encarte não encontrado' }, { status: 404 })
    }

    if (!encarte.pdfPath) {
      return NextResponse.json({ erro: 'Encarte sem PDF' }, { status: 404 })
    }

    let buffer: Buffer | null = null

    // ── Tentativa 1: ler do /tmp (rápido) ──
    const filePath = path.join('/tmp/uploads', encarte.pdfPath)
    try {
      buffer = await readFile(filePath)
      console.log(`[pdf] Servindo do /tmp: ${encarte.pdfPath} (${buffer.length} bytes)`)
    } catch {
      // /tmp não tem o arquivo (provável após deploy)
      console.log(`[pdf] Arquivo não encontrado no /tmp: ${encarte.pdfPath}`)
    }

    // ── Tentativa 2: reconstruir do base64 no Firestore ──
    if (!buffer && encarte.pdfBase64) {
      try {
        buffer = Buffer.from(encarte.pdfBase64, 'base64')
        console.log(`[pdf] Reconstruído do Firestore base64: ${buffer.length} bytes`)

        // Re-salva no /tmp para próximas requisições serem mais rápidas
        try {
          await mkdir('/tmp/uploads', { recursive: true })
          await writeFile(filePath, buffer)
          console.log(`[pdf] Re-salvo no /tmp para cache: ${encarte.pdfPath}`)
        } catch {
          // Ignora erro ao re-salvar (pode ser problema de permissão)
        }
      } catch (e) {
        console.error(`[pdf] Erro ao decodificar base64:`, e)
      }
    }

    if (!buffer) {
      return NextResponse.json(
        { erro: 'PDF não disponível. O arquivo foi perdido durante um deploy do servidor. Peça ao mercado para reenviar o encarte.' },
        { status: 404 },
      )
    }

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${encarte.titulo || 'encarte'}.pdf"`,
        'Cache-Control': 'public, max-age=3600',
        'Content-Length': String(buffer.length),
      },
    })
  } catch (e) {
    console.error('[pdf] erro:', e)
    return NextResponse.json({ erro: 'Erro ao servir PDF' }, { status: 500 })
  }
}
