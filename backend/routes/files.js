const express = require('express');
const { authMiddleware } = require('../middlewares/auth');
const { getFileTree, getFileContent, writeFileContent, flattenTree, createFile, createDir, deleteItem, renameItem, readOrder, writeOrder } = require('../services/fileService');
const { workspacePOKai, workspaceFEKai, workspaceBEKai, workspaceUXKai, workspaceQAKai, workspaceRoot, projectsRoot } = require('../config/env');

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

// Helper to get the correct workspace root based on agentId
function getWorkspaceRoot(agentId) {
  if (agentId === 'po-kai')   return workspacePOKai;
  if (agentId === 'fe-kai')   return workspaceFEKai;
  if (agentId === 'be-kai')   return workspaceBEKai;
  if (agentId === 'ux-kai')   return workspaceUXKai;
  if (agentId === 'qa-kai')   return workspaceQAKai;
  if (agentId === 'projects') return projectsRoot;
  return workspaceRoot;
}

/**
 * GET /api/files?agentId=po-kai&subpath=slug/section
 * Returns file tree of .md files (scoped to subpath if provided)
 */
router.get('/', async (req, res) => {
  try {
    const agentId = req.query.agentId || 'kai';
    const subpath = req.query.subpath || '';
    const allFiles = req.query.allFiles === 'true';
    let root = getWorkspaceRoot(agentId);
    if (subpath) {
      const p = require('path');
      const resolved = p.resolve(root, subpath);
      if (!resolved.startsWith(root)) return res.status(403).json({ error: 'Path fuera del workspace' });
      root = resolved;
    }
    const tree = await getFileTree(root, { allFiles });
    res.json(tree);
  } catch (err) {
    console.error('Error getting file tree:', err);
    res.status(500).json({ error: 'Error al obtener archivos' });
  }
});

/**
 * GET /api/files/flat?agentId=po-kai
 * Returns flat sorted list of files for dashboard
 */
router.get('/flat', async (req, res) => {
  try {
    const agentId = req.query.agentId || 'kai';
    const root = getWorkspaceRoot(agentId);
    const tree = await getFileTree(root);
    const flat = flattenTree(tree);
    res.json(flat);
  } catch (err) {
    console.error('Error getting flat file list:', err);
    res.status(500).json({ error: 'Error al obtener archivos' });
  }
});

/**
 * GET /api/content?path=relative/path.md&agentId=po-kai
 * Returns file content
 */
router.get('/content', async (req, res) => {
  const { path, agentId } = req.query;

  if (!path) {
    return res.status(400).json({ error: 'Ruta requerida' });
  }

  try {
    const root = getWorkspaceRoot(agentId || 'kai');
    const result = await getFileContent(path, root);
    res.json(result);
  } catch (err) {
    console.error('Error reading file:', err);
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }
    res.status(500).json({ error: err.message || 'Error al leer archivo' });
  }
});

/**
 * PUT /api/content?path=relative/path.md&agentId=po-kai
 * Updates file content
 */
router.put('/content', async (req, res) => {
  const { path, agentId } = req.query;
  const { content } = req.body;

  if (!path) {
    return res.status(400).json({ error: 'Ruta requerida' });
  }

  if (typeof content !== 'string') {
    return res.status(400).json({ error: 'Contenido requerido' });
  }

  try {
    const root = getWorkspaceRoot(agentId || 'kai');
    const result = await writeFileContent(path, content, root);
    res.json(result);
  } catch (err) {
    console.error('Error writing file:', err);
    res.status(500).json({ error: err.message || 'Error al escribir archivo' });
  }
});

/**
 * POST /api/files/create
 * Body: { path, agentId, content? }
 * Creates a new .md file
 */
router.post('/create', async (req, res) => {
  const { path: filePath, agentId, content = '' } = req.body;

  if (!filePath) return res.status(400).json({ error: 'Ruta requerida' });

  try {
    const root = getWorkspaceRoot(agentId || 'kai');
    const result = await createFile(filePath, root, content);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/files/mkdir
 * Body: { path, agentId }
 * Creates a new directory
 */
router.post('/mkdir', async (req, res) => {
  const { path: dirPath, agentId } = req.body;

  if (!dirPath) return res.status(400).json({ error: 'Ruta requerida' });

  try {
    const root = getWorkspaceRoot(agentId || 'kai');
    // createDir already creates _index.md internally
    await createDir(dirPath, root);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * DELETE /api/files
 * Body: { path, agentId }
 * Deletes a file or directory
 */
router.delete('/', async (req, res) => {
  const { path: itemPath, agentId } = req.body;

  if (!itemPath) return res.status(400).json({ error: 'Ruta requerida' });

  try {
    const root = getWorkspaceRoot(agentId || 'kai');
    const result = await deleteItem(itemPath, root);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/files/rename
 * Body: { oldPath, newPath, agentId }
 * Renames or moves a file/directory
 */
router.post('/rename', async (req, res) => {
  const { oldPath, newPath, agentId } = req.body;

  if (!oldPath || !newPath) return res.status(400).json({ error: 'Rutas requeridas' });

  try {
    const root = getWorkspaceRoot(agentId || 'kai');
    const result = await renameItem(oldPath, newPath, root);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/files/order?agentId=kai
 * Returns the custom order map
 */
router.get('/order', async (req, res) => {
  try {
    const root  = getWorkspaceRoot(req.query.agentId || 'kai');
    const order = await readOrder(root);
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/files/order
 * Body: { agentId, dirKey, items: ['name1', 'name2', ...] }
 * Saves custom order for a directory
 */
router.put('/order', async (req, res) => {
  const { agentId, dirKey = '', items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items must be array' });
  try {
    const root  = getWorkspaceRoot(agentId || 'kai');
    const order = await readOrder(root);
    order[dirKey] = items;
    await writeOrder(root, order);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
