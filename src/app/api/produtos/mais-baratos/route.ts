import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/produtos/mais-baratos
 * Retorna TODOS os produtos de TODOS os mercados, ordenados do mais barato para o mais caro.
 * Inclui nome do mercado para exibição.
 *
 * Query params:
 *   limit=20  — número máximo de produtos (default 50)
 *   order=asc — asc (mais baratos) ou desc (mais caros)
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const limit = parseInt(url.searchParams.get('limit') || '50', 10)
    const order = url.searchParams.get('order') === 'desc' ? 'desc' : 'asc'

    const produtos = await db.produto.findAll()

    // Adiciona precoNum para ordenação
    const comPreco = produtos.map((p: any) => ({
      id: p.id,
      nome: p.nome,
      marca: p.marca,
      preco: p.preco,
      precoNum: parseFloat(String(p.preco).replace(/[^\d,]/g, '').replace(',', '.')) || 0,
      unidade: p.unidade,
      mercado: p.mercado,
    }))

    // Ordena por preço
    comPreco.sort((a: any, b: any) =>
      order === 'asc' ? a.precoNum - b.precoNum : b.precoNum - a.precoNum,
    )

    return NextResponse.json({
      produtos: comPreco.slice(0, limit),
      total: comPreco.length,
    })
  } catch (e) {
    console.error('[mais-baratos] erro:', e)
    return NextResponse.json({ erro: 'Erro ao buscar produtos' }, { status: 500 })
  }
}
