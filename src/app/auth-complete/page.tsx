'use client'

import { useEffect, useState } from 'react'

/**
 * /auth-complete?token=XXX
 *
 * Pagina intermediaria usada pelo APK (WebView) para completar
 * o login com Google. O fluxo e:
 *
 * 1. Usuario clica "Entrar com Google" no WebView
 * 2. Android abre o Chrome para o fluxo OAuth
 * 3. Apos autenticacao, Chrome volta ao app via custom scheme (panfletosbrasil://)
 * 4. Android carrega esta pagina no WebView com o idToken
 * 5. Esta pagina chama /api/auth/google-login → cookie e setado no WebView
 * 6. Redireciona para a home
 */
export default function AuthCompletePage() {
  const [erro, setErro] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')

    if (!token) {
      setErro('Token de autenticacao nao fornecido.')
      setLoading(false)
      return
    }

    fetch('/api/auth/google-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) {
          // Cookie eb_session foi setado pelo servidor no WebView
          window.location.href = '/'
        } else {
          setErro(data.erro || 'Erro ao fazer login com Google.')
        }
      })
      .catch((err) => {
        setErro('Erro de conexao: ' + err.message)
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-red-600 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-500 text-sm">Finalizando login com Google...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-white">
      <div className="text-center max-w-sm mx-auto px-6">
        <p className="text-red-600 font-medium mb-6">{erro}</p>
        <button
          onClick={() => (window.location.href = '/')}
          className="bg-red-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-red-700 transition-colors"
        >
          Voltar ao inicio
        </button>
      </div>
    </div>
  )
}