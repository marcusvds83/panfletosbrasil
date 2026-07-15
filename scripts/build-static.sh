#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# build-static.sh — Gera build estático do EncarteBrasil para hospedagem shared
# (Alphimedia / public_html). As API routes continuam no Render.
#
# Uso:  bash scripts/build-static.sh
# Saída: /home/z/my-project/download/encartebrasil-static.zip
# ──────────────────────────────────────────────────────────────────────────────
set -e

PROJECT_DIR="/home/z/my-project"
DIST_DIR="$PROJECT_DIR/dist-static"
ZIP_FILE="$PROJECT_DIR/download/encartebrasil-static.zip"

# URL do backend Render (API routes)
RENDER_URL="https://encarte-brasil.onrender.com"

echo "=== EncarteBrasil — Build Estático para Alphimedia ==="
echo ""

# 1) Limpa build anterior
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

# 2) Backup do next.config original e cria config estático
echo "[1/4] Buildando frontend estático..."
cp "$PROJECT_DIR/next.config.ts" "$PROJECT_DIR/next.config.ts.bak"
cat > "$PROJECT_DIR/next.config.ts" << 'CFGEOF'
import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  output: "export",
  typescript: { ignoreBuildErrors: true },
  reactStrictMode: false,
  images: { unoptimized: true },
};
export default nextConfig;
CFGEOF

# Move API routes para fora (output:export não suporta route handlers)
if [ -d "$PROJECT_DIR/src/app/api" ]; then
  mv "$PROJECT_DIR/src/app/api" "$PROJECT_DIR/src/app/_api_disabled"
fi

# 3) Roda build estático com NEXT_PUBLIC_API_BASE apontando pro Render
NEXT_PUBLIC_API_BASE="$RENDER_URL" \
npx next build 2>&1 | tail -30

# 4) Restaura config original e API routes
mv "$PROJECT_DIR/next.config.ts.bak" "$PROJECT_DIR/next.config.ts"
if [ -d "$PROJECT_DIR/src/app/_api_disabled" ]; then
  mv "$PROJECT_DIR/src/app/_api_disabled" "$PROJECT_DIR/src/app/api"
fi

# 5) Verifica se o diretório 'out' foi gerado
if [ ! -d "$PROJECT_DIR/out" ]; then
  echo "ERRO: diretório 'out' não foi gerado. Verifique os erros acima."
  exit 1
fi

# 5) Copia 'out' para dist-static
echo "[2/4] Copiando arquivos..."
cp -r "$PROJECT_DIR/out/"* "$DIST_DIR/"

# 6) Gera .htaccess para SPA routing (Apache)
echo "[3/4] Gerando .htaccess..."
cat > "$DIST_DIR/.htaccess" << 'HTACEOF'
# EncarteBrasil — SPA Routing + Cache
RewriteEngine On

# Redireciona www para non-www
# RewriteCond %{HTTP_HOST} ^www\.(.*)$ [NC]
# RewriteRule ^(.*)$ https://%1/$1 [R=301,L]

# Se o arquivo ou diretório existe, serve diretamente
RewriteCond %{REQUEST_FILENAME} -f [OR]
RewriteCond %{REQUEST_FILENAME} -d
RewriteRule ^ - [L]

# SPA fallback: tudo que não for arquivo → index.html
RewriteRule ^ index.html [L]

# Cache de assets estáticos (1 ano)
<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType text/css "access plus 1 year"
  ExpiresByType application/javascript "access plus 1 year"
  ExpiresByType image/png "access plus 1 year"
  ExpiresByType image/jpeg "access plus 1 year"
  ExpiresByType image/svg+xml "access plus 1 year"
  ExpiresByType image/x-icon "access plus 1 year"
  ExpiresByType font/woff2 "access plus 1 year"
  ExpiresByType application/manifest+json "access plus 1 hour"
</IfModule>

# Compressão
<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css application/javascript application/json image/svg+xml
</IfModule>

# Segurança
<IfModule mod_headers.c>
  Header set X-Content-Type-Options "nosniff"
  Header set X-Frame-Options "SAMEORIGIN"
</IfModule>
HTACEOF

# 7) Empacota em .zip
echo "[4/4] Empacotando .zip..."
rm -f "$ZIP_FILE"
cd "$DIST_DIR"
zip -r "$ZIP_FILE" . -x "*.DS_Store" 2>&1 | tail -3

# 8) Limpeza
rm -rf "$PROJECT_DIR/out"

echo ""
echo "=== PRONTO ==="
echo "Arquivo: $ZIP_FILE"
echo "Destino: descompactar no public_html de encartesbrasil.3codenexus.com.br"
echo "Backend API: $RENDER_URL"
echo ""
echo "IMPORTANTE: No Render, configure a variável:"
echo "  NEXT_PUBLIC_FIREBASE_API_KEY, _AUTH_DOMAIN, _PROJECT_ID, etc."
echo ""
echo "E no .env local (se testar):"
echo "  NEXT_PUBLIC_API_BASE=$RENDER_URL"