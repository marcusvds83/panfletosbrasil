'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import AdminPanel from './AdminPanel'
import MarketPanel from './MarketPanel'

interface AdminUser {
  tipo: 'admin' | 'mercado' | 'usuario'
  id: string
  email: string
  nome?: string
  status?: string
  photoURL?: string | null
}

async function api<T = Record<string, unknown>>(
  path: string,
  opts?: RequestInit,
): Promise<T> {
  const headers: Record<string, string> = {}
  if (!(opts?.body instanceof FormData)) headers['Content-Type'] = 'application/json'
  if (opts?.headers) Object.assign(headers, opts.headers as Record<string, string>)
  const res = await fetch(path, { credentials: 'include', headers, ...opts })
  if (!res.ok) {
    const data = await res.json().catch(() => ({ erro: 'Erro na requisição' }))
    throw new Error((data as { erro?: string }).erro || `Erro ${res.status}`)
  }
  return res.json() as Promise<T>
}

/**
 * Rota /admin — acessível apenas via URL direta.
 * Mostra tela de login admin (sem abas PF/PJ) e depois o AdminPanel.
 * Não aparece no app principal (mobile nem desktop).
 */
export default function AdminRoute() {
  const [session, setSession] = useState<AdminUser | null>(null)
  const [loading, setLoading] = useState(true)

  const checkAuth = useCallback(async () => {
    try {
      const data = await api<{ logado: boolean } & AdminUser>('/api/auth/me')
      if (data.logado && data.tipo === 'admin') {
        setSession({
          tipo: 'admin',
          id: data.id,
          email: data.email,
          nome: data.nome,
          status: data.status,
        })
      } else {
        setSession(null)
      }
    } catch {
      setSession(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  const handleLogout = useCallback(async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' })
    } catch { /* ignore */ }
    setSession(null)
    toast.success('Sessão encerrada')
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-900 gap-4">
        <motion.img
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          src="/icon-192.png"
          alt="EncarteBrasil"
          className="h-20 w-20 rounded-2xl"
        />
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="text-sm text-gray-300 font-medium"
        >
          Carregando painel admin...
        </motion.p>
      </div>
    )
  }

  // Se não é admin, mostra login admin direto (sem abas PF/PJ)
  if (!session || session.tipo !== 'admin') {
    return (
      <div className="min-h-screen flex flex-col bg-gray-900">
        <header className="bg-gray-950 text-white border-b border-gray-800">
          <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src="/icon-192.png" alt="EncarteBrasil" className="h-8 w-8 rounded-lg" />
              <h1 className="text-lg font-bold">EncarteBrasil — Admin</h1>
            </div>
            <a
              href="/"
              className="text-xs text-gray-400 hover:text-white transition-colors"
            >
              ← Voltar para o app
            </a>
          </div>
        </header>
        <main className="flex-1 max-w-md mx-auto w-full px-4 py-8 flex items-center justify-center">
          <AdminLoginForm onLogin={checkAuth} />
        </main>
      </div>
    )
  }

  // É admin — mostra AdminPanel
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <header className="bg-gray-900 text-white sticky top-0 z-50 shadow-md">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/icon-192.png" alt="EncarteBrasil" className="h-8 w-8 rounded-lg" />
            <h1 className="text-lg font-bold">Painel Admin</h1>
            <span className="text-xs bg-red-600 text-white px-2 py-0.5 rounded-full">
              {session.email}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/"
              className="text-xs text-gray-300 hover:text-white transition-colors mr-2"
            >
              ← App
            </a>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="text-white hover:bg-white/20 h-8 px-2"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-6">
        <AdminPanel onLogout={handleLogout} onLogin={checkAuth} />
      </main>
    </div>
  )
}

// ── Login admin isolado (sem abas PF/PJ) ─────────────────────────────────
function AdminLoginForm({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !senha) {
      toast.error('Preencha e-mail e senha')
      return
    }
    setLoading(true)
    try {
      await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, senha }),
      })
      toast.success('Login administrativo realizado!')
      onLogin()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao fazer login')
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-sm"
    >
      <div className="bg-white rounded-xl shadow-xl border border-gray-200 p-6">
        <div className="text-center mb-6">
          <img
            src="/icon-192.png"
            alt="EncarteBrasil"
            className="h-16 w-16 rounded-2xl mx-auto mb-3 shadow-md"
          />
          <h2 className="text-lg font-bold text-gray-900">Painel Administrativo</h2>
          <p className="text-xs text-gray-500 mt-1">
            Acesso restrito. Use suas credenciais de admin.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">E-mail</label>
            <input
              type="email"
              placeholder="admin@encartebrasil.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="w-full h-10 px-3 rounded-lg border border-gray-300 focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Senha</label>
            <input
              type="password"
              placeholder="••••••••"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              autoComplete="current-password"
              className="w-full h-10 px-3 rounded-lg border border-gray-300 focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full h-11 bg-gray-900 hover:bg-gray-800 text-white font-semibold rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? 'Entrando...' : 'Entrar como Admin'}
          </button>
        </form>
        <p className="text-[11px] text-gray-400 text-center mt-4">
          🔒 Esta área é restrita. Não compartilhe suas credenciais.
        </p>
      </div>
    </motion.div>
  )
}
