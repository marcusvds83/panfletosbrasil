/**
 * Panfletos Brasil PDF Parser
 *
 * Extrai dados de produtos (nome, marca, preço, unidade) de encartes PDF
 * de supermercados brasileiros.
 *
 * Suporta DOIS formatos comuns:
 *   1) Preço em linha separada:  "Arroz Tipo 1" \n "R$ 5,49 un."
 *   2) Preço na mesma linha:    "Banana Caturra kg R$ 4,99"
 *
 * IMPORTANTE: encartes BR são quase 100% MAIÚSCULOS. Os filtros de ruído
 * são cirúrgicos — só eliminam o que é claramente marketing/legal.
 */

// Tipos e parser de texto — sem dependência de módulo externo no import principal
// PDFParse e pdfjs-dist são importados dinamicamente dentro das funções

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface ProdutoExtraido {
  nome: string
  marca: string | null
  preco: string
  unidade: string | null
  descricao?: string | null
}

// Estrutura visual completa do encarte
export interface EncarteEstruturado {
  mercado: string | null
  titulo: string | null
  produtos: ProdutoExtraido[]
  contato: {
    telefone?: string | null
    instagram?: string | null
    site?: string | null
    endereco?: string | null
  }
  totalPaginas: number
  metodoUsado: string
  textoBruto: string
}

// ── Frases de marketing COMPLETAS a ignorar (só matches exatos) ───────────

const MARKETING_PHRASES = new Set([
  'OFERTA', 'SUPER OFERTA', 'MEGA OFERTA', 'OFERTA ESPECIAL',
  'PREÇO IMBATÍVEL', 'APROVEITE', 'IMPERDÍVEL',
  'MELHOR PREÇO', 'O MENOR PREÇO', 'MENOR PREÇO',
  'LEVE MAIS POR MENOS', 'ECONOMIA GARANTIDA', 'ECONOMIA TOTAL',
  'ESPECIAL DE HOJE', 'SÓ HOJE', 'ÚLTIMAS UNIDADES',
  'PREÇO ÚNICO', 'PREÇO ESPECIAL', 'PREÇO BAIXO',
  'FIRE SALE', 'LIQUIDAÇÃO', 'PROMOÇÃO', 'PROMO',
  'QUEIMA DE ESTOQUE', 'DESCONTO',
  'COMPRE E GANHE', 'LEVE 2 PAGUE 1', 'LEVE 3 PAGUE 2',
  'GARANTIA DE FRESQUURA', 'SEMPRE FRESCO',
  'QUALIDADE GARANTIDA', 'PRODUTO SELECIONADO',
])

// Padrões de texto legal / rodapé
const LEGAL_PATTERNS = [
  /ofertas?\s*(válida|sujeita)/i,
  /enquanto\s+durarem\s+(os\s+)?estoques/i,
  /imagens?\s+meramente\s+ilustrativa/i,
  /garantimos?\s+(a\s+)?quantidade/i,
  /formas?\s+de\s+pagamento/i,
  /dinheiro.*pix.*cart/i,
  /produtos?\s+(sujeitos?\s+)?à\s+disponibilidade/i,
  /preços?\s+válidos/i,
  /--\s*\d+\s+of\s+\d+\s*--/,
  /consulte\s+condi/i,
  /quantidades?\s+limitada/i,
  /este\s+encarte\s+é\s+fictício/i,
  /criado\s+exclusivamente\s+para/i,
  /clientes?\s+cadastrado/i,
]

// Padrão para detectar linhas que são apenas unidade
const UNIT_ONLY = /^(un\.?|kg|g|ml|l|cx|pct|dz|unidade)$/i

// Preço no INÍCIO da linha (formato 1: preço em linha separada)
// Aceita: R$ 19,90 | R$ 19.90 | R$19,90 | 19,90 | 19.90
const PRICE_LINE_REGEX = /^(?:R\$\s*)?(\d{1,4}(?:\.\d{3})*[.,]\d{2})/

// Preço em QUALQUER posição da linha (formato 2: preço inline)
const PRICE_INLINE_REGEX = /(?:R\$\s*)?(\d{1,4}(?:\.\d{3})*[.,]\d{2})/g

// Preço com R$ (para verificar se linha tem preço real, não só números soltos)
const HAS_REAL_PRICE = /R\$\s*\d{1,4}(?:\.\d{3})*[.,]\d{2}/

// Número decimal solto no final da linha (formato: "Detergente 500ml Ype" \n "1,99")
const BARE_PRICE_REGEX = /^(\d{1,4}(?:\.\d{3})*[.,]\d{2})$/

// Unidade após preço
const PRICE_UNIT_REGEX = /(?:R\$\s*)?[\d.,]+\s*(un\.?|kg|g|ml|l)/i

// Padrão para detectar preço com unidade no final: "R$ 5,49" ou "R$ 5,49 un."
const TAIL_PRICE_REGEX = /R\$\s*\d+[.,]\d{2}\s*(un\.?|kg|g|ml|l)?\s*$/

// Cabeçalhos de seção do encarte (com & ou sozinhos)
const SECTION_HEADERS = [
  /^mercearia/i,
  /^açougue/i,
  /^frios/i,
  /^hortifruti/i,
  /^higiene/i,
  /^limpeza/i,
  /^bebidas/i,
  /^laticínios/i,
  /^padaria/i,
  /^básicos/i,
  /^lácteos/i,
  /^carnes/i,
  /^verduras/i,
  /^frutas/i,
  /^legumes/i,
  /^latic[ií]nios/i,
]

/**
 * Verifica se uma linha é ruído puro.
 */
function isNoise(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return true
  if (trimmed.length < 3) return true
  if (/^\d+$/.test(trimmed)) return true
  if (/^[^\wáéíóúãõâêîôûçÁÉÍÓÚÃÕÂÊÎÔÛÇ]+$/i.test(trimmed)) return true
  if (UNIT_ONLY.test(trimmed)) return true
  if (/--\s*\d+\s+of\s+\d+\s*--/.test(trimmed)) return true

  for (const pattern of LEGAL_PATTERNS) {
    if (pattern.test(trimmed)) return true
  }

  const upper = trimmed.toUpperCase().trim()
  if (MARKETING_PHRASES.has(upper)) return true

  // Cabeçalhos de seção curtos sem preço
  for (const header of SECTION_HEADERS) {
    if (header.test(trimmed) && trimmed.length < 40 && !HAS_REAL_PRICE.test(trimmed)) return true
  }

  // "AÇOUGUE & FRIOS (PREÇO POR KG)" — header composto sem preço real
  if (/\&\s*(FRIOS|DERIVADOS|BÁSICOS)/i.test(trimmed) && !HAS_REAL_PRICE.test(trimmed)) return true
  if (/\(PREÇO\s+POR\s+KG\)/i.test(trimmed)) return true

  // Emojis puros
  if (/^[\u{1F300}-\u{1FAFF}\s]+$/u.test(trimmed)) return true

  // "ENCARTE ESPECIAL..."
  if (/^ENCARTE\s+(ESPECIAL|DA\s+SEMANA|DA\s+QUINZENA)/i.test(trimmed)) return true

  // "PRODUTO UNIDADE PREÇO" — header de tabela
  if (/^PRODUTO\s+UNIDADE\s+PREÇO/i.test(trimmed)) return true

  // Nome do mercado curto sem preço
  if (/^(SUPERMERCADO|MERCADO|ATACADO)\s+/i.test(trimmed) && trimmed.length < 40 && !HAS_REAL_PRICE.test(trimmed)) return true

  // "DE R$ XX POR APENAS" — frase de marketing
  if (/^DE\s+R\$\s*\d+[.,]\d{2}\s+POR\s+APENAS/i.test(trimmed)) return true

  // Emojis com texto curto tipo "🔥 ENCARTE ESPECIAL"
  if (/^[\u{1F300}-\u{1FAFF}]/u.test(trimmed) && trimmed.length < 80 && !HAS_REAL_PRICE.test(trimmed)) return true

  // "O ORGULHO DE ECONOMIZAR..." — slogan
  if (/^(O\s+)?ORGULHO\s+DE/i.test(trimmed)) return true

  return false
}

/**
 * Extrai unidade de uma string (detalhes ou preço)
 */
function extractUnit(text: string): string | null {
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|litro[s]?|unidade[s]?|rolo[s]?|pacote[s]?|cx|caixa[s]?|sachê[s]?|bandeja[s]?|garrafa[s]?|pet|vidro[s]?|dose[s]?|pct|dz|dúzia[s]?|un\.?)/i)
  if (m) {
    const num = m[1].replace(',', '.')
    let unit = m[2].toLowerCase()
    if (/^(litro|l)s?$/i.test(unit)) unit = 'L'
    else if (/^(quilo|kg)s?$/i.test(unit)) unit = 'kg'
    else if (/^(grama|g)s?$/i.test(unit)) unit = 'g'
    else if (/^(mililitro|ml)s?$/i.test(unit)) unit = 'ml'
    else if (/^un/i.test(unit)) unit = 'un'
    return `${num}${unit}`
  }
  return null
}

function extractUnitFromPriceLine(line: string): string | null {
  const m = line.match(PRICE_UNIT_REGEX)
  if (m) {
    let unit = m[1].replace('.', '').toLowerCase()
    if (/^un/i.test(unit)) return 'un'
    return unit
  }
  return null
}

/**
 * Extrai marca de uma string
 */
function extractMarca(text: string): string | null {
  const m = text.match(/[-–]\s*Marca\s+(.+)/i) || text.match(/marca[:\s]+(.+)/i)
  return m ? m[1].trim() : null
}

/**
 * Normaliza texto para dedup
 */
function normalizeForDedup(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Extrai unidade solta (sem número) do final de um texto.
 * Ex: "Banana Caturra kg" → "kg", "Alface Crespa unidade" → "un"
 */
function extractStandaloneUnit(text: string): string | null {
  const m = text.match(/(?:^|\s)(kg|g|ml|l|unidade|pacote|sachê|bandeja|garrafa|rolo[s]?|cx|caixa[s]?)\s*$/i)
  if (m) {
    let unit = m[1].toLowerCase()
    if (/^(litro|l)s?$/i.test(unit)) return 'L'
    if (/^(quilo|kg)s?$/i.test(unit)) return 'kg'
    if (/^(grama|g)s?$/i.test(unit)) return 'g'
    if (/^(mililitro|ml)s?$/i.test(unit)) return 'ml'
    if (/^un/i.test(unit)) return 'un'
    return unit
  }
  return null
}

/**
 * Tenta extrair um produto de uma linha que tem nome + preço inline.
 * Formato: "Banana Caturra kg R$ 4,99" ou "Arroz Tipo 1 5 kg pacote R$ 24,90"
 */
function tryParseInline(line: string): ProdutoExtraido | null {
  // Precisa ter preço em algum lugar (R$ XX,XX ou só XX,XX se a linha for curta o suficiente)
  // Reset regex (global flag)
  PRICE_INLINE_REGEX.lastIndex = 0
  const priceMatch = PRICE_INLINE_REGEX.exec(line)
  if (!priceMatch) return null

  // Se não tem R$, verifica se é um preço solto válido (não é CPF, telefone, etc)
  const hasRS = /R\$\s*\d/.test(line)
  if (!hasRS) {
    // Sem R$: só aceita se o número tiver vírgula decimal (formato BR)
    // e estiver no final da linha
    const bare = priceMatch[0]
    if (!bare.includes(',')) return null
    // Rejeita se parece CPF (XXX.XXX.XXX-XX) ou telefone
    if (/\d{3}\.\d{3}/.test(line.replace(bare, ''))) return null
  }

  // Normaliza preço: sempre R$ XX,XX (vírgula decimal)
  // Detecta se é formato BR (vírgula decimal) ou US (ponto decimal)
  let precoRaw = priceMatch[1]
  // Se tem vírgula: formato BR (ex: 1.299,90 → 1299.90)
  if (precoRaw.includes(',')) {
    precoRaw = precoRaw.replace(/\./g, '').replace(',', '.')
  } else if (precoRaw.includes('.')) {
    // Se tem ponto mas não vírgula: pode ser decimal US (12.90) ou milhar BR (1.299)
    // Se tem 2 dígitos após o último ponto: é decimal (12.90 → 12.90)
    const parts = precoRaw.split('.')
    if (parts[parts.length - 1].length === 2) {
      // Decimal: 12.90 → remove pontos de milhar se houver e mantém como decimal
      precoRaw = parts.length > 2
        ? parts.slice(0, -1).join('') + '.' + parts[parts.length - 1]
        : precoRaw
    } else {
      // Milhar sem decimal: 1.299 → 1299
      precoRaw = precoRaw.replace(/\./g, '')
    }
  }
  const precoStr = `R$ ${Number(precoRaw).toFixed(2).replace('.', ',')}`
  const priceIndex = priceMatch.index!

  // Tudo antes do R$ é o candidato a nome + unidade
  const beforePrice = line.substring(0, priceIndex).trim()
  if (beforePrice.length < 3) return null

  // Remove unidade solta do final do nome (ex: "kg", "unidade", "pacote")
  let nome = beforePrice.replace(/\s+(kg|g|ml|l|unidade|pacote|sachê|bandeja|garrafa|rolo[s]?|cx|caixa[s]?)\s*$/i, '').trim()

  // Se o nome ficou muito curto, usa tudo antes do preço
  if (nome.length < 3) nome = beforePrice

  // Se o nome é só números ou símbolos, ignora
  if (nome.length < 3) return null
  if (/^\d+$/.test(nome)) return null

  // Pega unidade: com número (5kg) ou solta (kg) do trecho antes do preço
  const unidade = extractUnit(beforePrice) || extractStandaloneUnit(beforePrice) || extractUnitFromPriceLine(line.substring(priceIndex))

  return {
    nome,
    marca: null,
    preco: precoStr,
    unidade,
  }
}

/**
 * Divide uma linha que contém múltiplos preços R$ em segmentos,
 * cada um potencialmente um produto. Útil quando pdfjs funde colunas.
 * Ex: "Banana kg R$ 4,99  Arroz 5kg R$ 24,90" → ["Banana kg R$ 4,99", "Arroz 5kg R$ 24,90"]
 */
function splitMultiPrice(line: string): string[] {
  const matches = [...line.matchAll(/R\$\s*\d+[.,]\d{2}/g)]
  if (matches.length <= 1) return [line]

  const segments: string[] = []
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index!
    const end = matches[i].index! + matches[i][0].length
    // Texto antes deste preço (desde o fim do segmento anterior ou início da linha)
    const segStart = i === 0 ? 0 : (matches[i - 1].index! + matches[i - 1][0].length)
    const before = line.substring(segStart, start).trim()
    const priceAndAfter = line.substring(start, i < matches.length - 1 ? matches[i + 1].index! : undefined).trim()
    // Junta o texto antes com o preço
    const segment = (before + ' ' + priceAndAfter).trim()
    if (segment.length > 5) segments.push(segment)
  }
  return segments
}

/**
 * Parser principal
 */
export function parseProdutosDoTexto(text: string): ProdutoExtraido[] {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0)
  const produtos: ProdutoExtraido[] = []
  const usedIndices = new Set<number>()
  const seenKeys = new Set<string>()

  // ── PASSO 1: Linhas com preço inline (formato tabela) ─────────────────
  // Processa TODAS as linhas que têm preço inline (nome + R$ XX,XX na mesma linha)
  for (let i = 0; i < lines.length; i++) {
    if (usedIndices.has(i)) continue
    if (isNoise(lines[i])) continue

    // Pula linhas que SÃO SÓ preço (sem nome) — essas são tratadas no PASSO 2
    // Mas NÃO pula linhas que têm nome + preço inline
    if (BARE_PRICE_REGEX.test(lines[i])) continue

    // Verifica se a linha tem múltiplos preços (colunas fundidas)
    const priceMatches = lines[i].match(/R\$\s*\d+[.,]\d{2}/g)
    if (priceMatches && priceMatches.length > 1) {
      // Divide em segmentos e processa cada um
      const segments = splitMultiPrice(lines[i])
      for (const seg of segments) {
        if (isNoise(seg)) continue
        const inline = tryParseInline(seg)
        if (!inline) continue
        if (isNoise(inline.nome)) continue
        if (inline.nome.length < 3) continue
        const dedupKey = `${normalizeForDedup(inline.nome)}|${inline.preco}`
        if (seenKeys.has(dedupKey)) continue
        seenKeys.add(dedupKey)
        produtos.push(inline)
      }
      usedIndices.add(i)
      continue
    }

    const inline = tryParseInline(lines[i])
    if (!inline) continue

    // Verifica se nome não é ruído
    if (isNoise(inline.nome)) continue
    if (inline.nome.length < 3) continue

    const dedupKey = `${normalizeForDedup(inline.nome)}|${inline.preco}`
    if (seenKeys.has(dedupKey)) continue
    seenKeys.add(dedupKey)

    produtos.push(inline)
    usedIndices.add(i)
  }

  // ── PASSO 2: Nome em uma linha, preço na próxima (formato encarte) ──
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (usedIndices.has(i)) continue
    if (isNoise(line)) continue
    // Skip se é linha de preço ou tem preço inline (já tratado no passo 1)
    if (HAS_REAL_PRICE.test(line) || BARE_PRICE_REGEX.test(line)) continue
    // Precisa ter pelo menos 3 letras
    const letters = line.replace(/[^a-zA-ZÁÉÍÓÚÃÕÂÊÎÔÛÇàáéíóúãõâêîôûç]/g, '')
    if (letters.length < 3) continue
    // Muito curto
    if (line.length < 4) continue

    // Busca preço nas próximas 1-5 linhas (com ou sem R$)
    let precoStr: string | null = null
    let priceLineIndex = -1
    let priceUnit: string | null = null

    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      if (usedIndices.has(j)) continue
      // Tenta com R$ primeiro
      let priceMatch = lines[j].match(HAS_REAL_PRICE)
      if (!priceMatch) {
        // Tenta preço solto (só número decimal no formato BR)
        const bare = lines[j].match(BARE_PRICE_REGEX)
        if (bare && bare[1].includes(',')) {
          priceMatch = bare as any
        }
      }
      if (priceMatch) {
        // Extrai o número do preço
        const numMatch = lines[j].match(/(\d{1,4}(?:\.\d{3})*[.,]\d{2})/)
        if (numMatch) {
          const precoNum = numMatch[1].replace(/\./g, '').replace(',', '.')
          precoStr = `R$ ${Number(precoNum).toFixed(2).replace('.', ',')}`
        }
        priceUnit = extractUnitFromPriceLine(lines[j])
        priceLineIndex = j
        break
      }
    }

    if (!precoStr) continue

    // Tenta encontrar detalhes (unidade/marca) entre nome e preço
    let detailsLine = ''
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      if (j === priceLineIndex) continue
      if (usedIndices.has(j)) continue
      if (!isNoise(lines[j]) && !PRICE_LINE_REGEX.test(lines[j])) {
        detailsLine = lines[j]
        usedIndices.add(j)
        break
      }
    }

    const unidade = extractUnit(detailsLine) || priceUnit || null
    const marca = extractMarca(detailsLine)

    // Limpa nome
    let nomeLimpo = line.replace(/\s+[-–]\s+.*$/, '').trim()
    if (nomeLimpo.length < 4) nomeLimpo = line.trim()

    const dedupKey = `${normalizeForDedup(nomeLimpo)}|${precoStr}`
    if (seenKeys.has(dedupKey)) continue
    seenKeys.add(dedupKey)

    produtos.push({
      nome: nomeLimpo,
      marca,
      preco: precoStr,
      unidade,
    })

    usedIndices.add(i)
    if (priceLineIndex >= 0) usedIndices.add(priceLineIndex)
  }

  // ── Dedup final: mesmo nome normalizado → mantém o mais longo ────────
  const dedupMap = new Map<string, ProdutoExtraido>()
  for (const p of produtos) {
    const key = normalizeForDedup(p.nome)
    const existing = dedupMap.get(key)
    if (!existing || p.nome.length > existing.nome.length) {
      dedupMap.set(key, p)
    }
  }

  return Array.from(dedupMap.values())
}

/**
 * Extrai texto via pdfjs-dist (sem worker, compatível com serverless/Render).
 * Usa threshold de Y=6 para agrupar itens na mesma linha visual.
 */
async function extractWithPdfjs(pdfBuffer: Buffer | Uint8Array): Promise<{ text: string; pages: number }> {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.js').then((m: any) => m.default || m)
  const uint8 = pdfBuffer instanceof Buffer ? new Uint8Array(pdfBuffer) : pdfBuffer
  const doc = await pdfjsLib.getDocument({
    data: uint8,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise
  const totalPages = doc.numPages
  const allLines: string[] = []
  const Y_THRESHOLD = 6 // tolerância maior para PDFs de encarte

  for (let i = 1; i <= totalPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const items = (content.items as any[])
      .filter((it: any) => it.str && it.str.trim().length > 0)
      .map((it: any) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0 }))

    if (items.length === 0) continue
    // Ordena: Y decrescente (topo→baixo), depois X crescente (esquerda→direita)
    items.sort((a: any, b: any) => {
      const yd = b.y - a.y
      return Math.abs(yd) > Y_THRESHOLD ? yd : a.x - b.x
    })

    // Agrupa itens na mesma linha visual
    let line = [items[0]]
    let ly = items[0].y
    for (let j = 1; j < items.length; j++) {
      const yd = Math.abs(items[j].y - ly)
      if (yd > Y_THRESHOLD) {
        allLines.push(line.map((it: any) => it.str).join(' '))
        line = [items[j]]
        ly = items[j].y
      } else {
        // Só adiciona gap se o item não está colado no anterior
        const prevItem = line[line.length - 1]
        const xGap = items[j].x - (prevItem.x + prevItem.w)
        if (xGap > 15) {
          // Gap grande — possível separação de coluna, adiciona como outra linha
          allLines.push(line.map((it: any) => it.str).join(' '))
          line = [items[j]]
          ly = items[j].y
        } else {
          line.push(items[j])
        }
      }
    }
    allLines.push(line.map((it: any) => it.str).join(' '))
  }

  await doc.destroy()
  return { text: allLines.join('\n'), pages: totalPages }
}

// ── Parser Visual com Clustering Espacial ─────────────────────────────────
// Em vez de ler linha por linha, agrupa itens por proximidade (cards de produto)
// Cada card = nome + descrição + preço próximos no espaço

interface TextItem {
  str: string
  x: number
  y: number
  w: number
  h: number
  page: number
  fontSize: number
}

/**
 * Extrai todos os itens de texto com coordenadas de um PDF.
 */
async function extractTextItems(pdfBuffer: Buffer | Uint8Array): Promise<{ items: TextItem[]; pages: number }> {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.js').then((m: any) => m.default || m)
  const uint8 = pdfBuffer instanceof Buffer ? new Uint8Array(pdfBuffer) : pdfBuffer
  const doc = await pdfjsLib.getDocument({
    data: uint8,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise

  const totalPages = doc.numPages
  const allItems: TextItem[] = []

  for (let i = 1; i <= totalPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    for (const item of content.items as any[]) {
      if (!item.str || !item.str.trim()) continue
      allItems.push({
        str: item.str.trim(),
        x: item.transform[4],
        y: item.transform[5],
        w: item.width || 0,
        h: item.height || 10,
        page: i,
        fontSize: item.height || 10,
      })
    }
  }

  await doc.destroy()
  return { items: allItems, pages: totalPages }
}

/**
 * Detecta se um item de texto é um preço.
 * Aceita: R$ XX,XX | R$ XX.XX | XX,XX | R$XX,XX
 */
function isPriceItem(item: TextItem): { isPrice: boolean; value: string | null } {
  const text = item.str.trim()
  // R$ XX,XX ou R$ XX.XX
  let m = text.match(/R\$\s*(\d{1,4}(?:\.\d{3})*[.,]\d{2})/)
  if (m) return { isPrice: true, value: m[1] }
  // Apenas número decimal no formato BR (XX,XX)
  if (/^\d{1,4},\d{2}$/.test(text) && Number(text.replace(',', '.')) > 0.5) {
    return { isPrice: true, value: text }
  }
  return { isPrice: false, value: null }
}

/**
 * Normaliza preço para R$ XX,XX
 */
function normalizarPreco(raw: string): string {
  let preco = raw
  if (preco.includes(',')) {
    preco = preco.replace(/\./g, '').replace(',', '.')
  } else if (preco.includes('.')) {
    const parts = preco.split('.')
    if (parts[parts.length - 1].length === 2) {
      preco = parts.length > 2 ? parts.slice(0, -1).join('') + '.' + parts[parts.length - 1] : preco
    } else {
      preco = preco.replace(/\./g, '')
    }
  }
  return `R$ ${Number(preco).toFixed(2).replace('.', ',')}`
}

/**
 * Extrai nome do mercado e título do encarte do cabeçalho.
 * Heurística: itens no topo da página (Y alto), sem preço, com fonte maior.
 */
function extrairHeader(items: TextItem[]): { mercado: string | null; titulo: string | null } {
  if (items.length === 0) return { mercado: null, titulo: null }

  // Agrupa por página
  const porPagina = new Map<number, TextItem[]>()
  for (const item of items) {
    if (!porPagina.has(item.page)) porPagina.set(item.page, [])
    porPagina.get(item.page)!.push(item)
  }

  // Pega primeira página
  const pagina1 = porPagina.get(1) || []
  if (pagina1.length === 0) return { mercado: null, titulo: null }

  // Ordena por Y decrescente (topo primeiro)
  pagina1.sort((a, b) => b.y - a.y)

  // Topo = primeiros 15% da página
  const maxY = pagina1[0].y
  const minY = Math.min(...pagina1.map(i => i.y))
  const threshold = maxY - (maxY - minY) * 0.15

  const headerItems = pagina1
    .filter(i => i.y >= threshold)
    .filter(i => !isPriceItem(i).isPrice)
    .filter(i => !isNoise(i.str))
    .sort((a, b) => b.y - a.y)

  let mercado: string | null = null
  let titulo: string | null = null

  // Mercado = primeiro item do cabeçalho (geralmente o maior/mais alto)
  if (headerItems.length > 0) {
    // Se o primeiro item contém "MERCADO", "SUPERMERCADO", etc.
    const mercadoIdx = headerItems.findIndex(i =>
      /MERCADO|SUPERMERCADO|ATACADO|FARM[AÁ]CIA|PET/i.test(i.str)
    )
    if (mercadoIdx >= 0) {
      mercado = headerItems[mercadoIdx].str
    } else {
      // Pega o item com maior fonte
      const maiorFonte = headerItems.reduce((a, b) => a.fontSize > b.fontSize ? a : b)
      mercado = maiorFonte.str
    }
  }

  // Título = segundo item (geralmente "OFERTA", "PROMOÇÃO", etc.)
  const tituloIdx = headerItems.findIndex(i =>
    /OFERTA|PROMO|ENCARTE|CATA|FOLHA/i.test(i.str) && i.str !== mercado
  )
  if (tituloIdx >= 0) {
    titulo = headerItems[tituloIdx].str
  }

  return { mercado, titulo }
}

/**
 * Extrai informações de contato do rodapé.
 */
function extrairContato(items: TextItem[]): {
  telefone?: string | null
  instagram?: string | null
  site?: string | null
  endereco?: string | null
} {
  const allText = items.map(i => i.str).join(' ')

  const telefone = allText.match(/\(?\d{2}\)?\s*\d{4,5}-?\d{4}/)?.[0] || null
  const instagram = allText.match(/@[\w_.]+/)?.[0] || null
  const site = allText.match(/www\.[\w.]+(?:\.com\.br|\.com|\.br)/i)?.[0] || null
  const endereco = allText.match(/(?:Rua|Av|Avenida|Travessa|Praça)\s+[^,]+,\s*\d+/i)?.[0] || null

  return { telefone, instagram, site, endereco }
}

/**
 * Parser visual: agrupa itens por proximidade espacial em cards de produto.
 *
 * Para cada preço encontrado, busca o nome mais próximo (acima ou à esquerda)
 * e a descrição (entre nome e preço).
 */
function extrairProdutosVisuais(items: TextItem[]): ProdutoExtraido[] {
  // Separa preços de nomes
  const precos: Array<{ item: TextItem; valor: string }> = []
  const nomes: TextItem[] = []

  for (const item of items) {
    const { isPrice, value } = isPriceItem(item)
    if (isPrice && value) {
      precos.push({ item, valor: value })
    } else if (!isNoise(item.str) && item.str.length >= 3) {
      // Não é preço nem ruído → candidato a nome/descrição
      nomes.push(item)
    }
  }

  const produtos: ProdutoExtraido[] = []
  const usedNomeIdx = new Set<number>()

  for (const { item: precoItem, valor } of precos) {
    // Busca o nome mais próximo: acima (Y maior) e no mesmo X (±100px)
    // Ou à esquerda (X menor) e no mesmo Y (±20px)
    let melhorNome: TextItem | null = null
    let melhorDistancia = Infinity
    let melhorIdx = -1

    for (let i = 0; i < nomes.length; i++) {
      if (usedNomeIdx.has(i)) continue
      const nome = nomes[i]

      // Só mesma página
      if (nome.page !== precoItem.page) continue

      const dy = nome.y - precoItem.y // positivo = nome está acima
      const dx = Math.abs(nome.x - precoItem.x)

      // Nome deve estar acima do preço (dy > 0) e próximo horizontalmente
      // Ou na mesma linha (|dy| < 15)
      let distancia: number
      if (dy > 0 && dy < 100 && dx < 150) {
        // Nome acima do preço — ideal
        distancia = dy + dx * 0.3
      } else if (Math.abs(dy) < 15 && nome.x < precoItem.x) {
        // Nome à esquerda do preço na mesma linha
        distancia = dx
      } else if (dy > 0 && dy < 200 && dx < 250) {
        // Nome mais distante acima — ainda possível
        distancia = dy + dx * 0.5
      } else {
        continue
      }

      if (distancia < melhorDistancia) {
        melhorDistancia = distancia
        melhorNome = nome
        melhorIdx = i
      }
    }

    if (melhorNome) {
      usedNomeIdx.add(melhorIdx)

      // Busca descrição entre nome e preço (item com Y entre os dois)
      let descricao: string | null = null
      for (let i = 0; i < nomes.length; i++) {
        if (usedNomeIdx.has(i)) continue
        const desc = nomes[i]
        if (desc.page !== precoItem.page) continue

        const descY = desc.y
        const nomeY = melhorNome.y
        const precoY = precoItem.y

        // Descrição está entre nome e preço
        if (descY < nomeY && descY > precoY && Math.abs(desc.x - melhorNome.x) < 80) {
          // Só pega se parece descrição (contém ml, kg, g, un, etc OU é curto)
          if (/(\d+\s*(?:ml|kg|g|l|un|cx|pct|dz)|\d+\s*(?:ml|kg|g|l)\b)/i.test(desc.str) || desc.str.length < 30) {
            descricao = desc.str
            usedNomeIdx.add(i)
            break
          }
        }
      }

      // Extrai unidade do nome ou descrição
      const textoCompleto = `${melhorNome.str} ${descricao || ''}`
      const unidade = extractUnit(textoCompleto) || extractStandaloneUnit(textoCompleto)

      // Limpa nome (remove unidade do final)
      let nomeLimpo = melhorNome.str
        .replace(/\s+(kg|g|ml|l|unidade|pacote|sachê|bandeja|garrafa|rolo[s]?|cx|caixa[s]?)\s*$/i, '')
        .trim()

      produtos.push({
        nome: nomeLimpo,
        marca: null,
        preco: normalizarPreco(valor),
        unidade,
        descricao,
      })
    }
  }

  // Dedup
  const seen = new Set<string>()
  return produtos.filter(p => {
    const key = `${normalizeForDedup(p.nome)}|${p.preco}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Função principal: extrai encarte estruturado com layout visual.
 * Combina parser visual (clustering espacial) com parser de texto (fallback).
 */
export async function extrairEncarteEstruturado(pdfBuffer: Buffer | Uint8Array): Promise<EncarteEstruturado> {
  const { produtos, textoBruto, totalPaginas, metodoUsado } = await extrairProdutosDoPDF(pdfBuffer)

  // Tenta extrair header e contato dos itens com coordenadas
  let mercado: string | null = null
  let titulo: string | null = null
  let contato: EncarteEstruturado['contato'] = {}

  // Se o método foi pdfjs-dist ou OCR, tenta extrair itens visuais
  try {
    const { items } = await extractTextItems(pdfBuffer)
    const header = extrairHeader(items)
    mercado = header.mercado
    titulo = header.titulo
    contato = extrairContato(items)

    // Se parser visual extrair mais produtos que o parser de texto, usa ele
    const produtosVisuais = extrairProdutosVisuais(items)
    if (produtosVisuais.length > produtos.length) {
      console.log(`[pdf-parser] Parser visual extraiu ${produtosVisuais.length} produtos (vs ${produtos.length} do parser de texto)`)
      return {
        mercado,
        titulo,
        produtos: produtosVisuais,
        contato,
        totalPaginas,
        metodoUsado: metodoUsado + '+Visual',
        textoBruto,
      }
    }
  } catch (e: any) {
    console.warn('[pdf-parser] Parser visual falhou, usando parser de texto:', e?.message || e)
  }

  return {
    mercado,
    titulo,
    produtos,
    contato,
    totalPaginas,
    metodoUsado,
    textoBruto,
  }
}

/**
 * Extrai texto de um buffer de PDF e retorna os produtos.
 *
 * Arquitetura (3 métodos com fallback automático):
 *
 * 1. PDFParse (pdf-parse v2) — melhor para PDFs digitais com colunas
 * 2. pdfjs-dist — mais robusto no Render, reconstrói linhas por coordenadas
 * 3. Tesseract OCR — fallback para PDFs escaneados/imagem (quando 1+2 falham)
 *
 * Escolhe o método com MAIS texto extraído.
 * Se nenhum método extrair texto suficiente, tenta OCR.
 */
export async function extrairProdutosDoPDF(pdfBuffer: Buffer | Uint8Array): Promise<{
  produtos: ProdutoExtraido[]
  textoBruto: string
  totalPaginas: number
  metodoUsado: string
}> {
  let textoBruto = ''
  let totalPaginas = 0
  let metodoUsado = 'nenhum'

  const resultados: Array<{ texto: string; paginas: number; metodo: string }> = []

  // ── Método 1: PDFParse (pdf-parse v2) ──────────────────────────────
  try {
    const { PDFParse } = await import('pdf-parse')
    const uint8 = pdfBuffer instanceof Buffer ? new Uint8Array(pdfBuffer) : pdfBuffer
    const parser = new PDFParse(uint8)
    const result = await parser.getText()
    const text = result.text || ''
    if (text.length > 0) {
      resultados.push({ texto: text, paginas: result.pages?.length || 0, metodo: 'PDFParse' })
      console.log(`[pdf-parser] PDFParse OK: ${text.length} chars, ${result.pages?.length || 0} páginas`)
    } else {
      console.log('[pdf-parser] PDFParse retornou texto vazio')
    }
  } catch (e1: any) {
    console.warn('[pdf-parser] PDFParse falhou:', e1?.message || e1)
  }

  // ── Método 2: pdfjs-dist (sem worker, compatível Render) ───────────
  try {
    const { text, pages } = await extractWithPdfjs(pdfBuffer)
    if (text.length > 0) {
      resultados.push({ texto: text, paginas: pages, metodo: 'pdfjs-dist' })
      console.log(`[pdf-parser] pdfjs-dist OK: ${text.length} chars, ${pages} páginas`)
    }
  } catch (e2: any) {
    console.warn('[pdf-parser] pdfjs-dist falhou:', e2?.message || e2)
  }

  // Escolhe o resultado com mais texto
  if (resultados.length > 0) {
    resultados.sort((a, b) => b.texto.length - a.texto.length)
    textoBruto = resultados[0].texto
    totalPaginas = resultados[0].paginas
    metodoUsado = resultados[0].metodo
    console.log(`[pdf-parser] Método escolhido: ${metodoUsado} (${textoBruto.length} chars)`)
  }

  // ── Método 3: Tesseract OCR (fallback para PDFs escaneados) ────────
  // Só tenta OCR se:
  // - Nenhum texto foi extraído (textoBruto vazio), OU
  // - Texto extraído é muito pouco (< 50 chars) e nenhum produto foi encontrado
  const produtosDaTentativa = parseProdutosDoTexto(textoBruto)
  const precisaOCR = textoBruto.length < 50 || (textoBruto.length < 200 && produtosDaTentativa.length === 0)

  if (precisaOCR) {
    console.log(`[pdf-parser] Texto insuficiente (${textoBruto.length} chars, ${produtosDaTentativa.length} produtos). Tentando OCR...`)

    try {
      const { text: ocrText, pages: ocrPages } = await extractWithOCR(pdfBuffer)
      if (ocrText.length > textoBruto.length) {
        textoBruto = ocrText
        totalPaginas = ocrPages
        metodoUsado = 'Tesseract-OCR'
        console.log(`[pdf-parser] OCR OK: ${ocrText.length} chars, ${ocrPages} páginas`)
      } else {
        console.log(`[pdf-parser] OCR retornou menos texto (${ocrText.length} chars), mantendo método anterior`)
      }
    } catch (e3: any) {
      console.warn('[pdf-parser] OCR falhou:', e3?.message || e3)
    }
  }

  const produtos = parseProdutosDoTexto(textoBruto)
  console.log(`[pdf-parser] ${produtos.length} produto(s) extraído(s) de ${textoBruto.length} chars (método: ${metodoUsado})`)

  return { produtos, textoBruto, totalPaginas, metodoUsado }
}

/**
 * Extrai texto via Tesseract OCR.
 *
 * Converte cada página do PDF para imagem (usando pdfjs-dist render)
 * e roda OCR em cada imagem com tesseract.js (português).
 *
 * Mais lento que extração direta (~5-15s por página), mas funciona
 * para PDFs escaneados/imagem onde pdf-parse e pdfjs-dist não extraem texto.
 */
async function extractWithOCR(pdfBuffer: Buffer | Uint8Array): Promise<{ text: string; pages: number }> {
  // Importa dinamicamente para não pesar o build se não for usado
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.js').then((m: any) => m.default || m)
  const { createWorker } = await import('tesseract.js')

  const uint8 = pdfBuffer instanceof Buffer ? new Uint8Array(pdfBuffer) : pdfBuffer
  const doc = await pdfjsLib.getDocument({
    data: uint8,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise

  // Cria worker do Tesseract com português
  const worker = await createWorker('por', 1, {
    logger: (m: any) => {
      if (m.status === 'recognizing text') {
        console.log(`[pdf-parser] OCR progress: ${Math.round(m.progress * 100)}%`)
      }
    },
  })

  const totalPages = doc.numPages
  const allText: string[] = []

  for (let i = 1; i <= totalPages; i++) {
    console.log(`[pdf-parser] OCR: processando página ${i}/${totalPages}...`)
    const page = await doc.getPage(i)
    const viewport = page.getViewport({ scale: 2.0 }) // escala maior = melhor OCR

    // Cria canvas para renderizar a página
    const { createCanvas } = await import('canvas')
    const canvas = createCanvas(viewport.width, viewport.height)
    const context = canvas.getContext('2d')

    // Renderiza a página no canvas
    await page.render({
      canvasContext: context,
      viewport,
    } as any).promise

    // Converte canvas para buffer PNG
    const imageBuffer = canvas.toBuffer('image/png')

    // Roda OCR na imagem
    const { data: { text } } = await worker.recognize(imageBuffer)
    allText.push(text)

    console.log(`[pdf-parser] OCR página ${i}: ${text.length} chars extraídos`)
  }

  await worker.terminate()
  await doc.destroy()

  return { text: allText.join('\n\n--- PÁGINA ---\n\n'), pages: totalPages }
}