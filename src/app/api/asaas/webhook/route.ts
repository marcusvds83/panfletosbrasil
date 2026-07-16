import { NextRequest, NextResponse } from 'next/server'
import { handlePaymentConfirmation } from '@/lib/asaas'

/**
 * POST /api/asaas/webhook
 * Webhook do Asaas — recebe confirmações de pagamento.
 * O Asaas envia POST com { event, payment } quando um pagamento é confirmado.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    console.log(`[asaas webhook] recebido: ${body?.event} — payment ${body?.payment?.id}`)

    const result = await handlePaymentConfirmation(body)

    if (!result.ok) {
      console.error(`[asaas webhook] falha: ${result.message}`)
      return NextResponse.json({ erro: result.message }, { status: 400 })
    }

    return NextResponse.json({ ok: true, message: result.message })
  } catch (err: any) {
    console.error(`[asaas webhook] erro: ${err?.message || err}`)
    return NextResponse.json({ erro: 'Erro interno' }, { status: 500 })
  }
}