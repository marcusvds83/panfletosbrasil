'use client'

/**
 * Error Boundary Global — captura erros de cliente antes de mostrar tela branca.
 * Em vez de "Application error: a client-side exception", mostra uma tela amigável
 * com botão de recarregar.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html>
      <body>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          fontFamily: 'system-ui, sans-serif',
          padding: '20px',
          textAlign: 'center',
        }}>
          <div style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            background: '#DC2626',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '20px',
            color: 'white',
            fontSize: '32px',
            fontWeight: 'bold',
          }}>
            !
          </div>
          <h2 style={{ color: '#1a1a1a', marginBottom: '8px', fontSize: '18px' }}>
            Ops! Algo deu errado
          </h2>
          <p style={{ color: '#666', fontSize: '14px', maxWidth: '350px', marginBottom: '20px' }}>
            Ocorreu um erro ao carregar esta página. Tente recarregar.
          </p>
          <p style={{ color: '#999', fontSize: '11px', marginBottom: '20px', maxWidth: '350px', wordBreak: 'break-word' }}>
            {error?.message || 'Erro desconhecido'}
          </p>
          <button
            onClick={() => reset()}
            style={{
              background: '#DC2626',
              color: 'white',
              border: 'none',
              padding: '12px 32px',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
            }}
          >
            Tentar novamente
          </button>
          <a
            href="/"
            style={{
              marginTop: '12px',
              color: '#DC2626',
              fontSize: '12px',
              textDecoration: 'underline',
            }}
          >
            Voltar ao início
          </a>
        </div>
      </body>
    </html>
  )
}
