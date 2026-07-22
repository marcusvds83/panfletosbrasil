'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Loader2, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, FileText } from 'lucide-react'

/**
 * /pdf-viewer?id=ENCARTE_ID
 *
 * Visualizador de PDF dentro do app (WebView) usando pdf.js + canvas.
 * Funciona no Android WebView (canvas é suportado nativamente).
 * Não redireciona para navegador externo.
 */
export default function PdfViewerPage() {
  const [pdfDoc, setPdfDoc] = useState<any>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [scale, setScale] = useState(1.2)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderTaskRef = useRef<any>(null)

  // Pega ID da URL
  const encarteId = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('id')
    : null

  const pdfUrl = encarteId ? `/api/encarte/${encarteId}/pdf` : null

  // Carrega o PDF com pdf.js (versão do navegador, não a do Node)
  useEffect(() => {
    if (!pdfUrl) {
      setError('ID do encarte não fornecido')
      setLoading(false)
      return
    }

    let cancelled = false

    const loadPdf = async () => {
      try {
        // Usa a versão CDN do pdf.js (compatível com browser/WebView)
        // Em vez de importar do node_modules (que é a versão Node/server)
        const pdfjsLib = (window as any).pdfjsLib

        if (!pdfjsLib) {
          // Carrega pdf.js do CDN se ainda não foi carregado
          await new Promise<void>((resolve, reject) => {
            const script = document.createElement('script')
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
            script.onload = () => resolve()
            script.onerror = () => reject(new Error('Falha ao carregar pdf.js'))
            document.head.appendChild(script)
          })
        }

        const lib = (window as any).pdfjsLib
        if (!lib) {
          throw new Error('pdf.js não carregou')
        }

        // Configura worker
        lib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'

        // Busca o PDF
        const loadingTask = lib.getDocument(pdfUrl)
        const doc = await loadingTask.promise

        if (cancelled) return

        setPdfDoc(doc)
        setTotalPages(doc.numPages)
        setCurrentPage(1)
        setLoading(false)
      } catch (e: any) {
        if (!cancelled) {
          console.error('[pdf-viewer] erro ao carregar:', e)
          setError(e?.message || 'Erro ao carregar PDF')
          setLoading(false)
        }
      }
    }

    loadPdf()
    return () => { cancelled = true }
  }, [pdfUrl])

  // Renderiza a página atual no canvas
  const renderPage = useCallback(async (pageNum: number) => {
    if (!pdfDoc || !canvasRef.current) return

    // Cancela render anterior se existir
    if (renderTaskRef.current) {
      try { renderTaskRef.current.cancel() } catch {}
    }

    const page = await pdfDoc.getPage(pageNum)
    const canvas = canvasRef.current
    const context = canvas.getContext('2d')
    if (!context) return

    const viewport = page.getViewport({ scale })
    canvas.width = viewport.width
    canvas.height = viewport.height
    canvas.style.width = '100%'
    canvas.style.height = 'auto'

    const renderTask = page.render({
      canvasContext: context,
      viewport,
    })

    renderTaskRef.current = renderTask
    await renderTask.promise
  }, [pdfDoc, scale])

  useEffect(() => {
    if (pdfDoc && !loading) {
      renderPage(currentPage)
    }
  }, [pdfDoc, currentPage, scale, loading, renderPage])

  // Controles
  const goPrev = () => {
    if (currentPage > 1) setCurrentPage(currentPage - 1)
  }
  const goNext = () => {
    if (currentPage < totalPages) setCurrentPage(currentPage + 1)
  }
  const zoomIn = () => setScale(s => Math.min(s + 0.3, 3))
  const zoomOut = () => setScale(s => Math.max(s - 0.3, 0.5))

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white gap-4">
        <Loader2 className="h-10 w-10 text-red-600 animate-spin" />
        <p className="text-sm text-gray-500">Carregando catálogo...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white gap-4 p-6">
        <FileText className="h-12 w-12 text-red-600" />
        <p className="text-sm text-red-500 text-center">{error}</p>
        <a href="/" className="text-xs text-red-600 hover:underline">Voltar ao início</a>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Toolbar fixa no topo */}
      <div className="sticky top-0 z-50 bg-gradient-to-r from-red-600 to-orange-500 text-white shadow-md">
        <div className="max-w-5xl mx-auto px-4 h-12 flex items-center justify-between gap-3">
          {/* Voltar */}
          <a
            href="/"
            className="flex items-center gap-1 text-sm font-medium hover:bg-white/20 px-2 py-1 rounded transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            Voltar
          </a>

          {/* Página atual */}
          <div className="flex items-center gap-2 text-sm">
            <button
              onClick={goPrev}
              disabled={currentPage <= 1}
              className="p-1.5 rounded hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs font-medium min-w-[60px] text-center">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={goNext}
              disabled={currentPage >= totalPages}
              className="p-1.5 rounded hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Zoom */}
          <div className="flex items-center gap-1">
            <button
              onClick={zoomOut}
              className="p-1.5 rounded hover:bg-white/20 transition-colors"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="text-xs min-w-[35px] text-center">
              {Math.round(scale * 100)}%
            </span>
            <button
              onClick={zoomIn}
              className="p-1.5 rounded hover:bg-white/20 transition-colors"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* PDF Canvas */}
      <div className="flex-1 flex justify-center py-4 px-2 overflow-auto">
        <canvas
          ref={canvasRef}
          className="shadow-lg rounded-lg bg-white max-w-full"
        />
      </div>

      {/* Navegação inferior (mobile) */}
      <div className="sticky bottom-0 z-50 bg-white border-t border-gray-200 lg:hidden">
        <div className="flex items-center justify-between px-4 h-12">
          <button
            onClick={goPrev}
            disabled={currentPage <= 1}
            className="flex items-center gap-1 text-sm font-medium text-red-600 disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
            Anterior
          </button>
          <span className="text-xs text-gray-500">
            {currentPage} de {totalPages}
          </span>
          <button
            onClick={goNext}
            disabled={currentPage >= totalPages}
            className="flex items-center gap-1 text-sm font-medium text-red-600 disabled:opacity-30"
          >
            Próxima
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
