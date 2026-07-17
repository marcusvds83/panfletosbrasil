import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'

const ODOO_WEBHOOK_URL = 'https://www.panfletosbrasil.3codenexus.com.br/web/hook/4c25f535-5267-437f-92a8-fdf0e164fff2'

const METODOS_VALIDOS = ['pix', 'cartao_mensal', 'cartao_recorrente', 'boleto'] as const
type MetodoPagamento = (typeof METODOS_VALIDOS)[number]

const METODO_LABEL: Record<string, string> = {
  pix: 'Pix',
  cartao_mensal: 'Cartão de Crédito (Mensal)',
  cartao_recorrente: 'Cartão de Crédito (Recorrente)',
  boleto: 'Boleto Bancário',
}

/** Normaliza segmento para o formato exato que o Odoo espera */
function normalizarSegmento(seg: string): string {
  const s = (seg || '').toLowerCase().trim()
  if (s === 'mercados' || s === 'mercado') return 'Mercados'
  if (s === 'petshops' || s === 'petshop' || s === 'pet shops') return 'PetShops'
  if (s === 'farmácias' || s === 'farmacias' || s === 'farmácia' || s === 'farmacia') return 'Farmácias'
  return seg || ''
}

/** Envia payload para o webhook Odoo e loga resultado */
async function enviarWebhook(url: string, payload: object): Promise<void> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = await res.text()
    console.log(`[webhook Odoo] status=${res.status} body=${body}`)
  } catch (err: any) {
    console.error(`[webhook Odoo] FALHA: ${err?.message || err}`)
  }
}

/**
 * POST /api/pagamento/metodo
 * Empresa escolhe a forma de pagamento → salva no DB + envia webhook para Odoo CRM.
 * O webhook cria uma nova oportunidade com todos os dados da empresa + contato + escolha de pagamento.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session || session.tipo !== 'mercado') {
      return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
    }

    const { metodo } = await req.json()
    if (!metodo || !METODOS_VALIDOS.includes(metodo)) {
      return NextResponse.json(
        { erro: 'Método inválido. Escolha: pix, cartao_mensal, cartao_recorrente ou boleto.' },
        { status: 400 },
      )
    }

    // Busca dados completos da empresa
    const empresa: any = await db.mercado.findUnique({
      where: { id: session.id },
    })
    if (!empresa) {
      return NextResponse.json({ erro: 'Empresa não encontrada' }, { status: 404 })
    }

    // Salva a escolha no DB
    await db.mercado.update(session.id, {
      formaPagamento: metodo,
      dataEscolhaPagamento: new Date().toISOString(),
    })

    // Monta descrição com a escolha de pagamento (campo description do Odoo)
    const metodoLabel = METODO_LABEL[metodo] || metodo
    const recorrente = metodo === 'cartao_recorrente'
    const segmentoNorm = normalizarSegmento(empresa.segmento)
    const descricao = [
      `ESCOLHA DE PAGAMENTO`,
      `Forma escolhida: ${metodoLabel}`,
      `Recorrente: ${recorrente ? 'Sim' : 'Não'}`,
      `Valor da mensalidade: R$ ${empresa.mensalidade || 399},00`,
      `Data da escolha: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
      '',
      `DADOS DA EMPRESA`,
      `Empresa: ${empresa.nome}`,
      `CNPJ: ${empresa.cnpj}`,
      `Cidade/UF: ${empresa.cidade}/${empresa.estado}`,
      `Segmento: ${segmentoNorm}`,
      `E-mail: ${empresa.emailLogin}`,
      `Telefone: ${empresa.telefone || 'Não informado'}`,
      '',
      `CONTATO DA EMPRESA`,
      `Responsável: ${empresa.responsavel || 'Não informado'}`,
      `CPF: ${empresa.cpf || 'Não informado'}`,
    ].join('\n')

    // Payload nos campos que a ação do servidor Odoo lê (conforme documento)
    const odooPayload = {
      nome_empresa: empresa.nome,
      cnpj: empresa.cnpj,
      email_empresa: empresa.emailLogin,
      telefone_empresa: empresa.telefone || '',
      segmento: segmentoNorm,
      nome_contato: empresa.responsavel || '',
      cpf: empresa.cpf || '',
      telefone_contato: empresa.telefone || '',
      email_contato: empresa.emailLogin,
      nome: `Pagamento — ${empresa.nome} — ${metodoLabel}`,
      description: descricao,
    }

    console.log(`[pagamento/metodo] webhook payload: ${JSON.stringify(odooPayload)}`)

    // Dispara webhook para Odoo CRM
    await enviarWebhook(ODOO_WEBHOOK_URL, odooPayload)

    return NextResponse.json({
      ok: true,
      metodo,
      metodoLabel,
      mensagem: 'Solicitação enviada! O administrador enviará o contrato e link de pagamento por e-mail.',
    })
  } catch (e) {
    console.error('[pagamento/metodo] erro:', e)
    return NextResponse.json({ erro: 'Erro ao processar pagamento' }, { status: 500 })
  }
}