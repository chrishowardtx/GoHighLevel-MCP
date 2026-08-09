#!/usr/bin/env bash
# Launch one fail-closed GHL MCP profile from its dedicated Keychain service.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE="${1:-}"

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

profile_key="$(security find-generic-password -a "$USER" -s "$KEYCHAIN_SERVICE" -w 2>/dev/null || true)"
if [[ ! "$profile_key" =~ ^pit- ]] || [ "${#profile_key}" -lt 20 ]; then
  echo "ERROR: $KEYCHAIN_SERVICE is missing or malformed in Keychain" >&2
  exit 1
fi

# Pin the credential destination. Inherited environment state must never redirect a Keychain token.
export GHL_BASE_URL="https://services.leadconnectorhq.com"

if [ "$PROFILE" = "agency" ]; then
  export GHL_AGENCY_API_KEY="$profile_key"
  unset GHL_API_KEY GHL_LOCATION_ID
else
  export GHL_API_KEY="$profile_key"
  export GHL_LOCATION_ID="$LOCATION_ID"
  unset GHL_AGENCY_API_KEY
fi

unset profile_key KEYCHAIN_SERVICE LOCATION_ID PROFILE
exec node "$HERE/dist/$SERVER_ENTRYPOINT"
