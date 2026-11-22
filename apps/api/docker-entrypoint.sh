#!/bin/sh
# Applies database migrations before starting when RUN_MIGRATIONS=true.
# Run this in one place only (a release step or a single replica).
set -e
if [ "$RUN_MIGRATIONS" = "true" ]; then
  echo "Applying database migrations"
  node ../../node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma
fi
exec "$@"
