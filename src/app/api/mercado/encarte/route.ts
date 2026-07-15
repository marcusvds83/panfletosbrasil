import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'

/**
 * Extrai produtos de um texto de encarte (PDF).
 * Procura por linhas com padrão: NOME PRODUTO ... R$ XX,XX
 * Também tenta capturar marca e unidade quando possível.
 */
interface ProdutoExtraido {
  nome: string
  marca?: string | null
  preco: string
  unidade?: string | null
}

function extrairProdutosDoTexto(texto: string): ProdutoExtraido[] {
  const produtos: ProdutoExtraido[] = []
  const vistos = new Set<string>()

  // Padrão 1: Linhas com preço no formato R$ XX,XX ou XX,XX no final
  // Ex: "Coca-Cola 2L R$ 8,99" ou "Arroz 5kg Tio João 12,90"
  const linhas = texto.split(/\r?\n/)

  // Regex para preço: R$ (opcional) + número + , + 2 dígitos
  const precoRegex = /R\$\s*(\d{1,4}(?:\.\d{3})*,\d{2})/g
  // Regex para unidade: kg, g, L, ml, un, pct, cx, etc.
  const unidadeRegex = /\b(\d+(?:,\d+)?)\s*(kg|g|ml|l|litro|litros|un|unidade|pct|pack|cx|caixa|lata|garrafa|frasco|saco|pacote|bandeja|dobro|grama|gramas)\b/i

  for (const linhaOriginal of linhas) {
    const linha = linhaOriginal.trim()
    if (linha.length < 3 || linha.length > 200) continue

    // Tenta encontrar preço
    const precos = [...linha.matchAll(precoRegex)]
    if (precos.length === 0) continue

    const preco = `R$ ${precos[0][1]}`
    // Remove o preço da linha para pegar o nome
    let nome = linha.replace(precoRegex, '').replace(/\s+/g, ' ').trim()

    // Remove caracteres especiais e números isolados no início
    nome = nome.replace(/^[\d\.\-\*]+\s*/, '').trim()

    // Tenta extrair unidade
    const unidadeMatch = nome.match(unidadeRegex)
    let unidade: string | null = null
    let marca: string | null = null
    if (unidadeMatch) {
      unidade = `${unidadeMatch[1]}${unidadeMatch[2]}`
    }

    // Se nome tem 2+ palavras, a primeira geralmente é o produto e a segunda a marca
    const palavras = nome.split(/\s+/)
    if (palavras.length >= 2) {
      // Heurística simples: se tem "de" ou preposição, marca está depois
      // Caso contrário, mantém nome completo
      if (palavras.length >= 3 && palavras[1].length <= 3) {
        // Pode ser "Arroz Tio João" -> marca = "Tio João"
        // Não confiável, então mantém tudo como nome
      }
    }

    // Filtra nomes muito curtos
    if (nome.length < 3) continue

    // Filtra duplicados (mesmo nome + preço)
    const chave = `${nome}|${preco}`
    if (vistos.has(chave)) continue
    vistos.add(chave)

    produtos.push({
      nome: nome.substring(0, 100), // limita tamanho
      marca,
      preco,
      unidade,
    })
  }

  return produtos
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session || session.tipo !== 'mercado') {
      return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
    }
    const formData = await req.formData()
    const file = formData.get('pdf') as File | null
    const titulo = formData.get('titulo') as string | null
    if (!file || !titulo) {
      return NextResponse.json({ erro: 'PDF e título obrigatórios' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const filename = `encarte_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`
    const uploadsDir = '/tmp/uploads'
    await mkdir(uploadsDir, { recursive: true })
    await writeFile(path.join(uploadsDir, filename), buffer)

    // Cria o encarte com status "processando"
    const encarte: any = await db.encarte.create({
      mercadoId: session.id,
      titulo,
      pdfPath: filename,
      statusExtracao: 'processando',
      extracaoLog: 'PDF recebido, iniciando extração...',
      criadoEm: new Date().toISOString(),
    })

    // Tenta extrair produtos do PDF
    let produtosExtraidos: ProdutoExtraido[] = []
    let logExtracao = 'PDF recebido. '
    try {
      // pdf-parse é importado dinamicamente para não quebrar build se não instalado
      const pdfParse = (await import('pdf-parse')).default
      const pdfData = await pdfParse(buffer)
      const texto = pdfData.text || ''
      logExtracao += `Texto extraído: ${texto.length} caracteres. `

      produtosExtraidos = extrairProdutosDoTexto(texto)
      logExtracao += `${produtosExtraidos.length} produtos encontrados.`

      // Salva os produtos extraídos no Firestore
      let salvos = 0
      for (const p of produtosExtraidos) {
        try {
          await db.produto.create({
            encarteId: encarte.id,
            mercadoId: session.id,
            nome: p.nome,
            marca: p.marca || null,
            preco: p.preco,
            unidade: p.unidade || null,
            normalizado: p.nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
            criadoEm: new Date().toISOString(),
          })
          salvos++
        } catch (e) {
          // ignora erro de produto individual
        }
      }
      logExtracao += ` ${salvos} produtos salvos.`

      // Atualiza status do encarte
      await db.encarte.update?.(encarte.id, {
        statusExtracao: 'concluido',
        extracaoLog: logExtracao,
      } as any)
    } catch (e: any) {
      logExtracao += ` Erro na extração: ${e?.message || String(e)}`
      // Tenta atualizar mesmo com erro
      try {
        await db.encarte.update?.(encarte.id, {
          statusExtracao: 'erro',
          extracaoLog: logExtracao,
        } as any)
      } catch {}
    }

    return NextResponse.json({
      ok: true,
      encarte,
      produtosExtraidos: produtosExtraidos.length,
      log: logExtracao,
    })
  } catch (e: any) {
    console.error('[encarte upload] erro:', e)
    return NextResponse.json({ erro: 'Erro ao enviar encarte: ' + String(e) }, { status: 500 })
  }
}
