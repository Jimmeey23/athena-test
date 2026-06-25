#!/usr/bin/env bash
set -euo pipefail

# ── Supabase Edge Function Deploy Script ───────────────────────────────────────
# Deploys one or all edge functions to your Supabase project.
#
# Usage:
#   npm run deploy:functions              # deploy all functions
#   npm run deploy:functions ticket-ai-chat  # deploy one function
#
# Prerequisites:
#   - Supabase CLI installed  (brew install supabase/tap/supabase  OR  npm i -g supabase)
#   - Logged in:              supabase login
#   - Project linked:         supabase link --project-ref <your-ref>
# ──────────────────────────────────────────────────────────────────────────────

FUNCTIONS_DIR="supabase/functions"
TARGET="${1:-}"

# ── Sanity checks ─────────────────────────────────────────────────────────────
if ! command -v supabase &>/dev/null; then
  echo ""
  echo "  ERROR: Supabase CLI not found."
  echo ""
  echo "  Install it with one of:"
  echo "    npm install -g supabase"
  echo "    brew install supabase/tap/supabase"
  echo "    https://supabase.com/docs/guides/cli/getting-started"
  echo ""
  exit 1
fi

if [ ! -d "$FUNCTIONS_DIR" ]; then
  echo "ERROR: $FUNCTIONS_DIR directory not found. Run from the project root."
  exit 1
fi

# ── Deploy ────────────────────────────────────────────────────────────────────
deploy_function() {
  local name="$1"
  echo "→ Deploying edge function: $name"
  supabase functions deploy "$name" --no-verify-jwt
  echo "  ✓ $name deployed"
}

if [ -n "$TARGET" ]; then
  # Deploy a single named function
  if [ ! -d "$FUNCTIONS_DIR/$TARGET" ]; then
    echo "ERROR: Function '$TARGET' not found in $FUNCTIONS_DIR/"
    echo ""
    echo "Available functions:"
    for dir in "$FUNCTIONS_DIR"/*/; do
      fname="$(basename "$dir")"
      [[ "$fname" == _* ]] && continue
      echo "  - $fname"
    done
    exit 1
  fi
  deploy_function "$TARGET"
else
  # Deploy all non-shared functions
  echo "Deploying all edge functions in $FUNCTIONS_DIR/ ..."
  echo ""
  count=0
  for dir in "$FUNCTIONS_DIR"/*/; do
    fname="$(basename "$dir")"
    # Skip _shared and other internal dirs
    [[ "$fname" == _* ]] && continue
    deploy_function "$fname"
    (( count++ )) || true
  done
  echo ""
  echo "Done — $count function(s) deployed."
fi
