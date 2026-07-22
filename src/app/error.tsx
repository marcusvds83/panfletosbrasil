'use client'

import { useEffect } from 'react'

/**
 * Error Boundary para páginas individuais.
 * Captura erros antes de mostrar "Application error".
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[ErrorBoundary]', error)
  }, [error])

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 gap-4">
      <div className="h-16 w-16 rounded-full bg-red-100 flex items-center justify-center">
        <span className="text-2xl font-bold text-red-600">!</span>
      </div>
      <h2 className="text-lg font-bold text-gray-800">Ops! Algo deu errado</h2>
      <p className="text-sm text-gray-500 max-w-sm text-center">
        Ocorreu um erro ao carregar esta página. Tente novamente.
      </p>
      <p className="text-xs text-gray-300 max-w-sm text-center break-words">
        {error?.message || 'Erro desconhecido'}
      </p>
      <div className="flex gap-3">
        <button
          onClick={() => reset()}
          className="bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition-colors"
        >
          Tentar novamente
        </button>
        <a
          href="/"
          className="bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold px-6 py-2.5 rounded-lg transition-colors"
        >
          Início
        </a>
      </div>
    </div>
  )
}
