#!/usr/bin/env bash
set -euo pipefail
# Usage: ./.audit/log.sh <tsv-file> <phase> <decision> <why> <evidence> <result>
file="${1:?tsv file required}"
shift
ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$ts" "$1" "$2" "$3" "$4" "$5" >>"$file"
