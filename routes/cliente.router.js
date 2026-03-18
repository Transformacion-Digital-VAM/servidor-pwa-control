const express = require('express');
const router = express.Router();
const clienteController = require('../controllers/cliente.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

router.post('/', verifyToken, clienteController.createCliente);
router.get('/', verifyToken, clienteController.getCliente);
router.get('/:id', verifyToken, clienteController.getClientePorId);
router.put('/:id', verifyToken, clienteController.updateCliente);
router.delete('/:id', verifyToken, clienteController.deleteCliente);

module.exports = router;