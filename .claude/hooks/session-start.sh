#!/bin/bash
# Prepara las sesiones de Claude Code en la web.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Plugin ECC (declarado en .claude/settings.json): la sesión en la nube no lo descarga sola.
# Si falla (red, GitHub caído), la sesión sigue sin él.
if command -v claude >/dev/null 2>&1 && ! grep -q '"ecc@ecc"' ~/.claude/plugins/installed_plugins.json 2>/dev/null; then
  claude plugin marketplace add affaan-m/ECC >/dev/null 2>&1 || true
  claude plugin install ecc@ecc --scope project >/dev/null 2>&1 || echo "Aviso: no se pudo instalar el plugin ECC." >&2
fi
