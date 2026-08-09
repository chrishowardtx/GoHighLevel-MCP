#!/usr/bin/env bash
# Launch one fail-closed GHL MCP profile from its dedicated Keychain service.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE="${1:-}"
MUTATION_FLAG="${2:-}"
EXPECTED_COMPANY_ID="QrtXvBAldeRz6qcMX1Xt"

if [ -n "$MUTATION_FLAG" ] && [ "$MUTATION_FLAG" != "--allow-mutations" ]; then
  echo "ERROR: unknown GHL MCP launcher option" >&2
  exit 1
fi

case "$PROFILE" in
  agency)
    KEYCHAIN_SERVICE="GHL_AGENCY_API_KEY"
    SERVER_ENTRYPOINT="agency-server.js"
    LOCATION_ID=""
    ;;
  nowlanded)
    KEYCHAIN_SERVICE="GHL_API_KEY"
    SERVER_ENTRYPOINT="server.js"
    LOCATION_ID="Zx79DWMGfKGScgkURSvh"
    ;;
  restoreradar)
    KEYCHAIN_SERVICE="GHL_RESTORERADAR_API_KEY"
    SERVER_ENTRYPOINT="server.js"
    LOCATION_ID="a7Caoa2IgRnZOazJLyAm"
    ;;
  hattie)
    KEYCHAIN_SERVICE="GHL_HATTIE_API_KEY"
    SERVER_ENTRYPOINT="server.js"
    LOCATION_ID="z8c1C1bHuVV8R3ttsd6o"
    ;;
  *)
    echo "ERROR: unknown GHL MCP profile" >&2
    exit 1
    ;;
esac

if [ "$PROFILE" = "agency" ] && [ -n "$MUTATION_FLAG" ]; then
  echo "ERROR: agency mode is always read-only" >&2
  exit 1
fi

profile_key="$(security find-generic-password -a "$USER" -s "$KEYCHAIN_SERVICE" -w 2>/dev/null || true)"
if [[ ! "$profile_key" =~ ^pit- ]] || [ "${#profile_key}" -lt 20 ]; then
  echo "ERROR: $KEYCHAIN_SERVICE is missing or malformed in Keychain" >&2
  exit 1
fi

# Pin the credential destination. Inherited environment state must never redirect a Keychain token.
export GHL_BASE_URL="https://services.leadconnectorhq.com"
export GHL_EXPECTED_COMPANY_ID="$EXPECTED_COMPANY_ID"

# Clear every credential/scope variable before exporting only this profile's values.
unset GHL_API_KEY
unset GHL_AGENCY_API_KEY GHL_RESTORERADAR_API_KEY GHL_HATTIE_API_KEY
unset GHL_LOCATION_ID GHL_EXPECTED_LOCATION_ID GHL_ENABLE_MUTATIONS

if [ "$PROFILE" = "agency" ]; then
  export GHL_AGENCY_API_KEY="$profile_key"
else
  export GHL_API_KEY="$profile_key"
  export GHL_LOCATION_ID="$LOCATION_ID"
  export GHL_EXPECTED_LOCATION_ID="$LOCATION_ID"
  if [ "$MUTATION_FLAG" = "--allow-mutations" ]; then
    export GHL_ENABLE_MUTATIONS="true"
  else
    unset GHL_ENABLE_MUTATIONS
  fi
fi

unset profile_key KEYCHAIN_SERVICE LOCATION_ID PROFILE MUTATION_FLAG EXPECTED_COMPANY_ID
exec node "$HERE/dist/$SERVER_ENTRYPOINT"
