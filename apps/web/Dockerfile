# PharmTrack web app. Build from the repository root:
#   docker build -f apps/web/Dockerfile -t pharmtrack-web \
#     --build-arg PHARMTRACK_API_URL=http://api:3000 .
# NEXT_PUBLIC_* settings and the API URL are fixed at build time.
FROM node:22-bookworm-slim AS build
WORKDIR /app
ARG PHARMTRACK_API_URL=http://api:3000
ARG NEXT_PUBLIC_SSO_AUTHORITY=
ARG NEXT_PUBLIC_SSO_CLIENT_ID=
ARG NEXT_PUBLIC_SSO_SCOPE="openid profile"
ARG NEXT_PUBLIC_SSO_ROLES_CLAIM=roles
ARG NEXT_PUBLIC_SSO_ROLE_MAP={}
ARG NEXT_PUBLIC_SSO_FACILITY_CLAIM=facility_id
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_STANDALONE=true \
    PHARMTRACK_API_URL=$PHARMTRACK_API_URL \
    NEXT_PUBLIC_SSO_AUTHORITY=$NEXT_PUBLIC_SSO_AUTHORITY \
    NEXT_PUBLIC_SSO_CLIENT_ID=$NEXT_PUBLIC_SSO_CLIENT_ID \
    NEXT_PUBLIC_SSO_SCOPE=$NEXT_PUBLIC_SSO_SCOPE \
    NEXT_PUBLIC_SSO_ROLES_CLAIM=$NEXT_PUBLIC_SSO_ROLES_CLAIM \
    NEXT_PUBLIC_SSO_ROLE_MAP=$NEXT_PUBLIC_SSO_ROLE_MAP \
    NEXT_PUBLIC_SSO_FACILITY_CLAIM=$NEXT_PUBLIC_SSO_FACILITY_CLAIM
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace apps/web --include-workspace-root=false --ignore-scripts
COPY apps/web apps/web
RUN npm run build -w apps/web

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3001 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3001/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
