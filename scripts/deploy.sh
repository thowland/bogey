#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Tim Howland

# Build and publish master to the bogey stack (spec §11.7, implementation plan §1.5).
#
#   1. Refuse anything but a clean master, so the deployed build names a merged commit
#      (ALLOW_DIRTY=1 permits uncommitted changes, for emergencies only), and run
#      `pnpm gate` (SKIP_VERIFY=1 skips it when close-sprint.sh has just run it).
#   2. Build with VITE_BOGEY_BUILD set to the commit, which the About page shows.
#   3. Upload the hashed files in assets/ for a year, immutable, and everything else
#      (index.html, sw.js, /pdfjs/ data, fonts outside assets/) no-cache.
#   4. Only then delete what the new build no longer has, so a page that is
#      mid-load never loses a file.
#   5. Invalidate CloudFront's copies, then check the live headers.
#
# Reads deploy.env (see deploy.env.example); the environment wins over it.

set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=./load-deploy-env.sh
source scripts/load-deploy-env.sh

STACK_NAME="${STACK_NAME:-bogey}"
REGION="us-east-1"
DIST_DIR="apps/web/dist"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" != "master" ]]; then
  echo "ERROR: deploys run only from master (on '$BRANCH'). Merge the sprint first." >&2
  exit 1
fi
if [[ -n "$(git status --porcelain)" && "${ALLOW_DIRTY:-0}" != "1" ]]; then
  echo "ERROR: uncommitted changes; the deployed build must name a commit (ALLOW_DIRTY=1 overrides)." >&2
  exit 1
fi

output() {
  aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

BUCKET="$(output BucketName)"
DIST_ID="$(output DistributionId)"
SITE_URL="$(output SiteUrl)"
if [[ -z "$BUCKET" || -z "$DIST_ID" || "$BUCKET" == "None" ]]; then
  echo "ERROR: stack '$STACK_NAME' has no BucketName or DistributionId. Run: pnpm infra:deploy" >&2
  exit 1
fi

BUILD="$(git rev-parse --short=12 HEAD)"
[[ -n "$(git status --porcelain)" ]] && BUILD="$BUILD-dirty"

if [[ "${SKIP_VERIFY:-0}" != "1" ]]; then
  pnpm gate
fi
VITE_BOGEY_BUILD="$BUILD" pnpm build

echo "Publishing build $BUILD to s3://$BUCKET (distribution $DIST_ID)..."
aws s3 sync "$DIST_DIR/assets/" "s3://$BUCKET/assets/" \
  --cache-control "public, max-age=31536000, immutable"
aws s3 sync "$DIST_DIR/" "s3://$BUCKET/" --exclude "assets/*" \
  --cache-control "no-cache"
aws s3 sync "$DIST_DIR/" "s3://$BUCKET/" --delete

aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" \
  --query 'Invalidation.{Id:Id,Status:Status}' --output table

echo "Checking the live headers..."
node scripts/check-live-headers.mjs "$SITE_URL"
echo "Deployed build $BUILD: $SITE_URL"
