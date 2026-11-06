#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Tim Howland

# Source this from a deploy script to load `deploy.env` if present.
# Lines look like KEY=VALUE; blank lines and `#` comments are ignored.
#
# Precedence: any variable already set in the calling environment WINS
# over the file. This lets one-off overrides work:
#
#   STACK_NAME=bogey-test ./scripts/infra-deploy.sh
#
# Path can be overridden via DEPLOY_ENV_FILE; defaults to ./deploy.env
# resolved from the repo root (the deploy scripts cd there before
# sourcing this).

DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-./deploy.env}"

if [[ -f "$DEPLOY_ENV_FILE" ]]; then
  while IFS='=' read -r raw_key raw_value; do
    # Skip blanks and comments.
    [[ -z "${raw_key// }" ]] && continue
    [[ "$raw_key" =~ ^[[:space:]]*# ]] && continue
    # Trim surrounding whitespace from the key.
    key="${raw_key#"${raw_key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"
    # Strip surrounding quotes from the value if present, for friendly
    # KEY="value with spaces" support.
    value="$raw_value"
    if [[ "$value" =~ ^\".*\"$ ]] || [[ "$value" =~ ^\'.*\'$ ]]; then
      value="${value:1:-1}"
    fi
    # Only export if the var isn't already set in the environment.
    # `${!key+x}` is the standard "is set, even to empty" check.
    if [[ -z "${!key+x}" ]]; then
      export "$key=$value"
    fi
  done < "$DEPLOY_ENV_FILE"
fi
