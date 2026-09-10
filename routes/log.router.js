const express = require('express');
const router = express.Router();
const logController = require('../controllers/log.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

// Rutas de logs (Protegidas para administradores)
router.get('/', verifyToken, logController.getLogs);
router.get('/:id', verifyToken, logController.getLogById);

module.exports = router;
