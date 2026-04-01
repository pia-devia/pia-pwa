const path = require('path');

// Load .env file — override=true ensures .env takes priority over inherited env vars
const envPath = path.join(__dirname, '..', '.env');
try {
  require('dotenv').config({ path: envPath, override: true });
} catch (e) {
  // .env not required in Docker (env vars come from compose)
}

const requiredVars = ['JWT_SECRET', 'WORKSPACE_ROOT'];

for (const varName of requiredVars) {
  if (!process.env[varName]) {
    console.error(`❌ Missing required environment variable: ${varName}`);
    process.exit(1);
  }
}

module.exports = {
  jwtSecret: process.env.JWT_SECRET,
  port: parseInt(process.env.PORT, 10) || 3001,
  workspaceRoot:   process.env.WORKSPACE_ROOT,
  workspacePOKai:  process.env.WORKSPACE_PO_KAI  || '/home/kai/.instances/po/workspace',
  workspaceFEKai:  process.env.WORKSPACE_FE_KAI  || '/home/kai/.instances/fe/workspace',
  workspaceBEKai:  process.env.WORKSPACE_BE_KAI  || '/home/kai/.instances/be/workspace',
  workspaceUXKai:  process.env.WORKSPACE_UX_KAI  || '/home/kai/.instances/ux/workspace',
  workspaceQAKai:  process.env.WORKSPACE_QA_KAI  || '/home/kai/.instances/qa/workspace',
  projectsRoot:    process.env.PROJECTS_ROOT      || '/home/kai/projects',
  jwtExpiry: '365d',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '8314284665',
};
