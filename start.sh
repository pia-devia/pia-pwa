#!/bin/bash
export PORT=3001
export OPENCLAW_GATEWAY_HOST=localhost
export OPENCLAW_CORE_PORT=18789
export OPENCLAW_CORE_TOKEN=dbcd15728a918b2a07a5c16f0fbd80683dd85f709528fb9a
export OPENCLAW_GATEWAY_TOKEN=dbcd15728a918b2a07a5c16f0fbd80683dd85f709528fb9a
export WORKSPACE_ROOT=/home/kai/workspace
export JWT_SECRET=kaios-secret-2026
exec node /home/kai/projects/KAI-PWA/code/backend/index.js
