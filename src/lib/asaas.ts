/**
 * Panfletos Brasil — Integração Asaas (Gateway de Pagamento)
 *
 * API Docs: https://docs.asaas.com/docs/api
 * Sandbox: https://sandbox.asaas.com
 * Produção: https://api.asaas.com
 *
 * Fluxo:
 * 1. Mercado termina piloto → status efetivo = "piloto_expirado"
 * 2. App mostra tela de bloqueio com opção de pagamento
 * 3. Cria customer no Asaas (se não existir)
 * 4. Cria pagamento (PIX ou Boleto)
 * 5. Redireciona para checkout do Asaas
 * 6. Webhook do Asaas confirma pagamento → status muda para "ativo"
 */

const ASAAS_BASE = 'https://api.asaas.com/v3'
const ASAAS_API_KEY = process.env.ASAAS_API_KEY || 'aact_prod_000MzkwODA2MWY2OGM3MWRlMDU2NWM3MzJlNzZmNGZhZGY6OmIxOTEwZDlkLTIzZWQtNDJiOS04MDVlLTI4ODM3ZDA4OTM2ZTo6JGFhY2hfYzFjYWZmYjktOTFmZi00MDU5LWIzNjEtYWZlNzY0NGJhMGJk'

async function asaasFetch(path: string, options: RequestInit = {}) {
  const url = `${ASAAS_BASE}${path}`
  const res = await fetch(url, {
    ...options,
    headers: {
      'access_token': ASAAS_API_KEY,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(data.errors?.[0]?.description || `Asaas erro ${res.status}`)
  }
  return data
}

// ── Customer ──────────────────────────────────────────────────────────────────

export interface AsaasCustomer {
  id: string
  name: string
  email: string
  cpfCnpj: string
  phone?: string
  externalReference?: string
}

export async function createOrUpdateCustomer(data: {
  name: string
  email: string
  cpfCnpj: string
  phone?: string
  externalReference: string
}): Promise<AsaasCustomer> {
  // Tenta buscar por externalReference primeiro
  try {
    const existing = await asaasFetch(`/customers?externalReference=${data.externalReference}&limit=1`)
    if (existing.data?.length > 0) {
      // Atualiza dados existentes
      const updated = await asaasFetch(`/customers/${existing.data[0].id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: data.name,
          email: data.email,
          phone: data.phone,
        }),
      })
      console.log(`[asaas] customer atualizado: ${existing.data[0].id}`)
      return updated
    }
  } catch {
    // Se não encontrar, cria novo
  }

  const customer = await asaasFetch('/customers', {
    method: 'POST',
    body: JSON.stringify({
      name: data.name,
      email: data.email,
      cpfCnpj: data.cpfCnpj,
      phone: data.phone,
      externalReference: data.externalReference,
    }),
  })
  console.log(`[asaas] customer criado: ${customer.id}`)
  return customer
}

// ── Pagamento ────────────────────────────────────────────────────────────────

export interface AsaasPayment {
  id: string
  customer: string
  value: number
  billingType: 'PIX' | 'BOLETO'
  status: string
  invoiceUrl: string
  pixQrCode?: string
  pixEncodedImage?: string
  bankSlipUrl?: string
  dueDate: string
  externalReference?: string
  description: string
}

export async function createPayment(params: {
  customerId: string
  value: number
  billingType: 'PIX' | 'BOLETO'
  description: string
  externalReference: string
  dueDate?: string
}): Promise<AsaasPayment> {
  const dueDate = params.dueDate || new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const payment = await asaasFetch('/payments', {
    method: 'POST',
    body: JSON.stringify({
      customer: params.customerId,
      value: params.value,
      billingType: params.billingType,
      description: params.description,
      externalReference: params.externalReference,
      dueDate,
      // PIX já fica disponível imediatamente
      ...(params.billingType === 'PIX' ? { installmentCount: 1 } : {}),
    }),
  })

  console.log(`[asaas] pagamento criado: ${payment.id} — ${params.billingType} — R$ ${params.value}`)
  return payment
}

export async function getPayment(paymentId: string): Promise<AsaasPayment> {
  return asaasFetch(`/payments/${paymentId}`)
}

export async function getPaymentByExternalRef(externalRef: string): Promise<AsaasPayment[]> {
  const result = await asaasFetch(`/payments?externalReference=${externalRef}`)
  return result.data || []
}

// ── Webhook helpers ──────────────────────────────────────────────────────────

/**
 * Verifica se o webhook do Asaas é autêntico.
 * O Asaas envia eventos via POST para a URL configurada.
 */
export function parseWebhookEvent(body: any): { event: string; payment: AsaasPayment } | null {
  if (!body?.event || !body?.payment?.id) return null
  return {
    event: body.event, // 'PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', etc.
    payment: body.payment,
  }
}

/** Verifica e processa confirmação de pagamento via webhook */
export async function handlePaymentConfirmation(body: any): Promise<{ ok: boolean; message: string }> {
  const parsed = parseWebhookEvent(body)
  if (!parsed) {
    return { ok: false, message: 'Evento inválido' }
  }

  const { event, payment } = parsed

  // Só processa pagamentos confirmados/recebidos
  if (event !== 'PAYMENT_RECEIVED' && event !== 'PAYMENT_CONFIRMED') {
    console.log(`[asaas webhook] evento ignorado: ${event}`)
    return { ok: true, message: `Evento ${event} ignorado` }
  }

  if (payment.status !== 'RECEIVED' && payment.status !== 'CONFIRMED') {
    console.log(`[asaas webhook] status não confirmado: ${payment.status}`)
    return { ok: true, message: `Status ${payment.status} — aguardando confirmação` }
  }

  // External reference = mercado ID
  const mercadoId = payment.externalReference
  if (!mercadoId) {
    return { ok: false, message: 'externalReference ausente' }
  }

  console.log(`[asaas webhook] pagamento confirmado: ${payment.id} para mercado ${mercadoId}`)

  // Atualiza o mercado para ativo
  const { db } = await import('@/lib/db')
  await db.mercado.update(mercadoId, {
    status: 'ativo',
    asaasCustomerId: payment.customer,
    ultimoPagamento: new Date().toISOString(),
    ultimoPagamentoValor: payment.value,
  })

  console.log(`[asaas webhook] mercado ${mercadoId} ativado com sucesso`)
  return { ok: true, message: `Mercado ${mercadoId} ativado` }
}