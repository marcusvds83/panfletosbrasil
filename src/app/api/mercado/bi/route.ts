import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'

// CRÍTICO: impede cache do Next.js — cada chamada deve buscar dados frescos.
// Sem isso, o Next.js pode cachear a resposta e TODAS as empresas veriam o
// mesmo BI (o da primeira empresa que chamou).
export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

/**
 * BI do Mercado — retorna métricas APENAS do mercado logado.
 *
 * Cada empresa deve ver SOMENTE os cliques/visualizações dos seus próprios
 * produtos. O filtro é feito por `session.id` (ID único do mercado logado).
 *
 * Logs detalhados adicionados para diagnosticar caso todas as empresas
 * estejam vendo a mesma contagem.
 */
export async function GET() {
  try {
    const session = await getSession()
    if (!session || session.tipo !== 'mercado') {
      return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
    }

    const mercadoId = session.id

    // VALIDAÇÃO CRÍTICA: se mercadoId for vazio/undefined, NÃO busca cliques
    // (evita que o Firestore retorne TODOS os documentos por filtro inválido)
    if (!mercadoId || typeof mercadoId !== 'string' || mercadoId.trim() === '') {
      console.error(`[bi] ERRO: session.id inválido para email=${session.email} id=${JSON.stringify(mercadoId)}`)
      return NextResponse.json(
        {
          erro: 'Sessão inválida — faça login novamente',
          topProdutos: [],
          totalVisualizacoes: 0,
          totalCliquesProdutos: 0,
          cliquesPorRegiao: [],
          cliquesSemana: [],
          trend: 0,
          regiao: '',
        },
        { status: 200 }
      )
    }

    console.log(`[bi] mercadoId=${mercadoId} email=${session.email} — buscando cliques`)

    // Todos os registros de interação deste mercado (filtrado por mercadoId)
    const todos = await db.cliqueProduto.findByMarket(mercadoId)

    console.log(`[bi] mercadoId=${mercadoId} total de registros encontrados: ${todos.length}`)

    // Separar visualizações de mercado vs cliques em produto.
    // Defensivo: valida tipo e produtoId antes de filtrar.
    const visualizacoes = todos.filter(
      (c: any) => c && typeof c === 'object' && c.tipo === 'mercado'
    )
    const cliquesProduto = todos.filter(
      (c: any) =>
        c &&
        typeof c === 'object' &&
        c.tipo !== 'mercado' &&
        typeof c.produtoId === 'string' &&
        c.produtoId.length > 0
    )

    console.log(`[bi] mercadoId=${mercadoId} visualizacoes=${visualizacoes.length} cliquesProduto=${cliquesProduto.length}`)

    // Top 10 produtos mais clicados (somente cliques de produto deste mercado)
    const counts: Record<string, number> = {}
    for (const c of cliquesProduto) {
      const pid = String(c.produtoId || '')
      if (!pid) continue
      counts[pid] = (counts[pid] || 0) + 1
    }
    const topProdutosGrouped = Object.entries(counts)
      .map(([produtoId, cnt]) => ({ produtoId, _count: { id: cnt } }))
      .sort((a, b) => b._count.id - a._count.id)
      .slice(0, 10)

    const topComNomes = await Promise.all(
      topProdutosGrouped.map(async (tp: any) => {
        try {
          const produto = await db.produto.findUnique(tp.produtoId)
          // Valida que o produto realmente pertence a este mercado (defensivo)
          if (produto && produto.mercadoId && produto.mercadoId !== mercadoId) {
            console.warn(`[bi] produto ${tp.produtoId} pertence a outro mercado (${produto.mercadoId}) — pulando`)
            return null
          }
          return {
            nome: produto?.nome || 'Desconhecido',
            marca: produto?.marca || '',
            cliques: tp._count.id,
          }
        } catch {
          return null
        }
      })
    ).then((arr) => arr.filter(Boolean) as { nome: string; marca: string; cliques: number }[])

    // Market info
    const mercado = await db.mercado.findUnique({
      where: { id: mercadoId },
      select: { cidade: true, estado: true, nome: true },
    })
    const regiao = mercado ? `${mercado.cidade}/${mercado.estado}` : ''

    // Interações por semana (TODAS: visualizações + cliques de produto deste mercado)
    const semanas: Record<string, number> = {}
    for (const c of todos) {
      try {
        const d = new Date(c.criadoEm)
        if (isNaN(d.getTime())) continue
        const weekStart = new Date(d)
        weekStart.setDate(d.getDate() - d.getDay())
        const key = weekStart.toISOString().slice(0, 10)
        semanas[key] = (semanas[key] || 0) + 1
      } catch {
        continue
      }
    }

    const cliquesSemana = Object.entries(semanas)
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 8)
      .reverse()
      .map(([semana, total]) => ({ semana, total }))

    const thisWeek = cliquesSemana.length >= 1 ? cliquesSemana[cliquesSemana.length - 1]?.total || 0 : 0
    const lastWeek = cliquesSemana.length >= 2 ? cliquesSemana[cliquesSemana.length - 2]?.total || 0 : 0
    const trend = lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : 0

    const payload = {
      topProdutos: topComNomes,
      totalVisualizacoes: visualizacoes.length,
      totalCliquesProdutos: cliquesProduto.length,
      cliquesPorRegiao: [{ regiao, total: todos.length }],
      cliquesSemana,
      trend,
      regiao,
      // Debug info (não sensível): confirma o filtro no client
      _debug: {
        mercadoId,
        mercadoNome: mercado?.nome || null,
        totalRegistros: todos.length,
        timestamp: new Date().toISOString(),
      },
    }

    console.log(`[bi] mercadoId=${mercadoId} retornando: visualizacoes=${payload.totalVisualizacoes} cliquesProduto=${payload.totalCliquesProdutos} topProdutos=${payload.topProdutos.length}`)

    // Headers explícitos para evitar cache em qualquer camada
    const res = NextResponse.json(payload)
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
    res.headers.set('Pragma', 'no-cache')
    res.headers.set('Expires', '0')
    return res
  } catch (err) {
    console.error('[bi] erro:', err)
    return NextResponse.json({ erro: 'Erro ao buscar BI' }, { status: 500 })
  }
}
