#!/usr/bin/env bash
# Prüft, dass alle Secrets unter deploy/secrets/ wirklich mit sops verschlüsselt sind
# (fängt ein vergessenes `sops -e` ab, bevor der Klartext im Repo landet).
# Braucht weder sops noch den Schlüssel. Aufruf: make secrets-check (überall).
set -euo pipefail
cd "$(dirname "$0")/secrets"

fail=0
for f in */*.sops.yaml; do
  # sops hängt einen Block "sops:" mit der Prüfsumme (mac) an
  if ! grep -q '^sops:' "$f" || ! grep -q '^ *mac: ENC\[' "$f"; then
    echo "FEHLER: $f ist nicht mit sops verschlüsselt" >&2
    fail=1
    continue
  fi
  # Jeder Wert unter data/stringData muss ENC[…] sein
  if ! awk '
    /^[^ ]/ { inside = ($0 ~ /^(data|stringData):/) ; next }
    inside && /^ +[^ ]/ && $0 !~ /: ENC\[/ { print "  Klartext: " $1; bad = 1 }
    END { exit bad }
  ' "$f" >&2; then
    echo "FEHLER: $f enthält unverschlüsselte Werte" >&2
    fail=1
    continue
  fi
  echo "ok  $f"
done
exit "$fail"
