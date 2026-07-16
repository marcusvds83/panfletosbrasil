import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { createOrUpdateCustomer, createPayment } from '@/lib/asaas'

/**
 * POST /api/asaas/checkout
 * Cria um pagamento no Asaas e retorna o link de checkout.
 * Usado quando o piloto expira e o mercado precisa pagar para continuar.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session || session.tipo !== 'mercado') {
      return NextResponse.json({ erro: 'Acesso negado' }, { status: 401 })
    }

    const body = await req.json()
    const { billingType } = body as { billingType?: 'PIX' | 'BOLETO' }
    const tipo = (billingType || 'PIX').toUpperCase() as 'PIX' | 'BOLETO'

    // Busca dados do mercado
    const mercado = await db.mercado.findUnique({ where: { id: session.id } })
    if (!mercado) {
      return NextResponse.json({ erro: 'Mercado não encontrado' }, { status: 404 })
    }

    const mensalidade = (mercado as any).mensalidade || 399

    // Cria ou atualiza customer no Asaas
    const customer = await createOrUpdateCustomer({
      name: (mercado as any).nome || 'Mercado',
      email: (mercado as any).emailLogin || session.email,
      cpfCnpj: (mercado as any).cnpj || '',
      phone: (mercado as any).telefone || '',
      externalReference: mercado.id,
    })

    // Cria pagamento
    const payment = await createPayment({
      customerId: customer.id,
      value: mensalidade,
      billingType: tipo,
      description: `Panfletos Brasil — Mensalidade ${tipo === 'PIX' ? '(PIX)' : '(Boleto)'} — ${(mercado as any).nome}`,
      externalReference: mercado.id,
    })

    // Salva o ID do customer e payment no mercado
    await db.mercado.update(mercado.id, {
      asaasCustomerId: customer.id,
      asaasPaymentId: payment.id,
    } as any)

    console.log(`[asaas checkout] criado: payment=${payment.id} tipo=${tipo} valor=${mensalidade} mercado=${mercado.id}`)

    // Retorna os dados do pagamento
    return NextResponse.json({
      ok: true,
      paymentId: payment.id,
      value: payment.value,
      billingType: payment.billingType,
      status: payment.status,
      invoiceUrl: payment.invoiceUrl,
      pixQrCode: payment.pixQrCode || null,
      pixEncodedImage: payment.pixEncodedImage || null,
      bankSlipUrl: payment.bankSlipUrl || null,
      dueDate: payment.dueDate,
    })
  } catch (err: any) {
    console.error(`[asaas checkout] erro: ${err?.message || err}`)
    return NextResponse.json({ erro: err?.message || 'Erro ao criar pagamento' }, { status: 500 })
  }
}