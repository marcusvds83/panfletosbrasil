import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { extrairEncarteEstruturado } from '@/lib/pdf-parser'

/**
 * O PDF é armazenado em DUAS formas:
 * 1. /tmp/uploads/ — para acesso rápido durante a sessão (efêmero, some no deploy)
 * 2. pdfBase64 no Firestore — persiste entre deploys (até 1MB, limite do Firestore)
 *
 * Quando o /tmp é apagado (deploy), o endpoint /api/encarte/[id]/pdf
 * reconstrói o arquivo a partir do base64 no Firestore.
 */

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session || session.tipo !== 'mercado') {
      return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
    }
    const formData = await req.formData()
    const file = formData.get('pdf') as File | null
    const titulo = formData.get('titulo') as string | null
    const dataInicio = formData.get('dataInicio') as string | null
    const dataFim = formData.get('dataFim') as string | null
    if (!file || !titulo) {
      return NextResponse.json({ erro: 'PDF e título obrigatórios' }, { status: 400 })
    }
    if (!dataInicio || !dataFim) {
      return NextResponse.json({ erro: 'Data início e fim da promoção são obrigatórias' }, { status: 400 })
    }
    // Validação: dataFim deve ser >= dataInicio
    if (new Date(dataFim) < new Date(dataInicio)) {
      return NextResponse.json({ erro: 'Data fim deve ser igual ou posterior à data início' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const filename = `encarte_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`

    // Salva no /tmp (efêmero) para acesso rápido
    const uploadsDir = '/tmp/uploads'
    await mkdir(uploadsDir, { recursive: true })
    await writeFile(path.join(uploadsDir, filename), buffer)

    // Salva como base64 no Firestore (persiste entre deploys)
    // Firestore permite até 1MB por documento. PDFs maiores que ~700KB
    // não serão salvos no Firestore (só no /tmp, que é efêmero).
    const pdfBase64 = buffer.length < 700 * 1024
      ? buffer.toString('base64')
      : null

    if (!pdfBase64) {
      console.warn(`[encarte upload] PDF muito grande (${buffer.length} bytes) — não será salvo no Firestore, apenas no /tmp (efêmero)`)
    }

    // Cria o encarte com status "processando"
    const encarte: any = await db.encarte.create({
      mercadoId: session.id,
      titulo,
      pdfPath: filename,
      pdfBase64,
      pdfSize: buffer.length,
      dataInicio,
      dataFim,
      statusExtracao: 'processando',
      extracaoLog: 'PDF recebido, aguardando revisão dos produtos...',
      criadoEm: new Date().toISOString(),
    })

    // ── Extrai produtos do PDF usando parser inteligente ─────────────────
    let produtosExtraidos: Array<{ nome: string; marca: string | null; preco: string; unidade: string | null; id?: string }> = []
    let logExtracao = 'PDF recebido. '
    let mercadoDetectado: string | null = null
    let tituloDetectado: string | null = null
    let contato: any = {}
    let metodoUsado = 'desconhecido'
    let totalPaginas = 0
    try {
      const encarteEstruturado = await extrairEncarteEstruturado(buffer)
      mercadoDetectado = encarteEstruturado.mercado
      tituloDetectado = encarteEstruturado.titulo
      contato = encarteEstruturado.contato
      metodoUsado = encarteEstruturado.metodoUsado
      totalPaginas = encarteEstruturado.totalPaginas
      const { produtos, textoBruto } = encarteEstruturado
      console.log(`[encarte upload] parser: ${produtos.length} produtos, texto=${textoBruto.length}chars, paginas=${totalPaginas}, metodo=${metodoUsado}, mercado=${mercadoDetectado || 'N/A'}`)

      // ── Salva os produtos automaticamente no banco ───────────────────
      let salvos = 0
      for (const p of produtos) {
        try {
          const salvo = await db.produto.create({
            encarteId: encarte.id,
            mercadoId: session.id,
            nome: p.nome,
            marca: p.marca || null,
            preco: p.preco,
            unidade: p.unidade || null,
            normalizado: p.nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
            criadoEm: new Date().toISOString(),
          })
          produtosExtraidos.push({
            id: salvo.id,
            nome: p.nome,
            marca: p.marca,
            preco: p.preco,
            unidade: p.unidade,
          })
          salvos++
        } catch (prodErr: any) {
          console.error(`[encarte upload] erro ao salvar produto "${p.nome}":`, prodErr?.message || prodErr)
        }
      }

      if (salvos > 0) {
        // Atualiza status do encarte para concluído
        await db.encarte.update(encarte.id, {
          statusExtracao: 'concluido',
          extracaoLog: `Extração automática concluída via ${metodoUsado}. ${salvos} produto(s) salvo(s).`,
        })
        logExtracao += `${salvos} produto(s) extraído(s) via ${metodoUsado} e salvo(s) automaticamente.`
      } else if (textoBruto.length === 0) {
        logExtracao += `Nenhum texto foi extraído do PDF (tentado: PDFParse, pdfjs-dist e OCR). O PDF pode estar corrompido ou protegido.`
      } else {
        logExtracao += `Texto extraído via ${metodoUsado} (${textoBruto.length} caracteres) mas nenhum produto com preço foi encontrado. Verifique se os preços estão no formato R$ XX,XX ou XX,XX.`
      }
    } catch (e: any) {
      console.error('[encarte upload] erro parser:', e)
      logExtracao += ` Erro na extração: ${e?.message || String(e)}`
    }

    return NextResponse.json({
      ok: true,
      encarte,
      produtos: produtosExtraidos,
      log: logExtracao,
      mercadoDetectado: mercadoDetectado || null,
      tituloDetectado: tituloDetectado || null,
      contato: contato || {},
      metodoExtracao: metodoUsado || 'desconhecido',
      totalPaginas: totalPaginas || 0,
    })
  } catch (e: any) {
    console.error('[encarte upload] erro:', e)
    return NextResponse.json({ erro: 'Erro ao enviar encarte: ' + String(e) }, { status: 500 })
  }
}