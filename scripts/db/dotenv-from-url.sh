#!/usr/bin/env bash
set -euo pipefail
URL="${1:-}"
[[ -z "$URL" ]] && { echo "Usage: $0 <postgresql://user:pass@host:port/db?schema=...>"; exit 2; }

urldecode(){ python3 - <<'PY' "$1"; import sys,urllib.parse as u; print(u.unquote(sys.argv[1])) ; PY ; }

url="$URL"; url="${url%\"}"; url="${url#\"}"
rest="${url#*://}"
base="${rest%%\?*}"
userinfo="${base%%@*}"; hostpath="${base#*@}"
[[ "$userinfo" == "$base" ]] && { userinfo=""; hostpath="$base"; }
hostport="${hostpath%%/*}"
db="${hostpath#*/}"
user="$(urldecode "${userinfo%%:*}")"
pass="$(urldecode "${userinfo#*:}")"
host="${hostport%%:*}"
port="${hostport#*:}"; [[ -z "$port" || "$port" == "$host" ]] && port="5432"

tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
# Update or append keys in .env
touch .env
awk -v user="$user" -v pass="$pass" -v host="$host" -v port="$port" -v db="$db" '
  BEGIN{keys["PGHOST"]=host; keys["PGPORT"]=port; keys["PGUSER"]=user; keys["PGPASSWORD"]=pass; keys["PGDATABASE"]=db;}
  BEGINFILE{seen["PGHOST"]=seen["PGPORT"]=seen["PGUSER"]=seen["PGPASSWORD"]=seen["PGDATABASE"]=0}
  {
    if ($0 ~ /^(PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE)=/) {
      split($0,a,"="); k=a[1]; if (k in keys) {print k"="keys[k]; seen[k]=1; next}
    }
    print
  }
  ENDFILE{
    for (k in keys) if (!seen[k]) print k"="keys[k]
  }' .env > "$tmp"
mv "$tmp" .env
echo "Wrote PG* variables to .env (host=$host port=$port db=$db user=$user)."
