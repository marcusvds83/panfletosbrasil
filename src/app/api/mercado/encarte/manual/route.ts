import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session || session.tipo !== 'mercado') {
      return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
    }

    const body = await req.json()
    const { encarteId, itens } = body as {
      encarteId: string
      itens: Array<{ nome: string; marca: string; preco: string; unidade: string }>
    }

    if (!encarteId || !Array.isArray(itens) || itens.length === 0) {
      return NextResponse.json({ erro: 'encarteId e itens são obrigatórios' }, { status: 400 })
    }

    // Verifica se o encarte pertence ao mercado logado
    const encartes = await db.encarte.findMany({ where: { mercadoId: session.id } })
    const encarte = encartes.find((e: any) => e.id === encarteId)
    if (!encarte) {
      return NextResponse.json({ erro: 'Encarte não encontrado' }, { status: 404 })
    }

    // Salva os produtos manuais
    let salvos = 0
    for (const item of itens) {
      if (!item.nome || !item.preco) continue
      const precoStr = String(item.preco).trim()
      // Valida que o preço tem algum dígito
      if (!/\d/.test(precoStr)) continue
      // Converte para número para validar > 0
      const precoNum = parseFloat(precoStr.replace(/[^\d,.-]/g, '').replace(',', '.'))
      if (isNaN(precoNum) || precoNum <= 0) continue
      try {
        // CORREÇÃO: armazena preco como STRING formatada em BRL
        // (antes era armazenado como número, quebrando o parsePreco no MyListView)
        const precoFormatado = `R$ ${precoNum.toFixed(2).replace('.', ',')}`
        await db.produto.create({
          mercadoId: session.id,
          encarteId,
          nome: item.nome,
          marca: item.marca || null,
          preco: precoFormatado,
          unidade: item.unidade || 'un',
          normalizado: item.nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
          criadoEm: new Date().toISOString(),
        })
        salvos++
      } catch (prodErr: any) {
        console.error(`[encarte manual] erro ao salvar produto "${item.nome}":`, prodErr?.message || prodErr)
      }
    }

    if (salvos === 0) {
      return NextResponse.json({ erro: 'Nenhum item válido para salvar' }, { status: 400 })
    }

    // Atualiza status do encarte
    await db.encarte.update(encarteId, {
      statusExtracao: 'concluido',
      extracaoLog: `Entrada manual concluída. ${salvos} produto(s) salvo(s).`,
    })

    return NextResponse.json({ ok: true, totalItens: salvos })
  } catch (e: any) {
    console.error('[encarte manual] erro:', e)
    return NextResponse.json({ erro: 'Erro ao salvar produtos: ' + String(e) }, { status: 500 })
  }
}