const express = require('express');
const router = express.Router();
const clienteController = require('../controllers/cliente.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

router.post('/', verifyToken, clienteController.createCliente); //verifyToken
router.get('/', verifyToken, clienteController.getCliente); //verifyToken
router.get('/:id', verifyToken, clienteController.getClientePorId); //verifyToken
router.put('/:id', verifyToken, clienteController.updateCliente); //verifyToken
router.delete('/:id', verifyToken, clienteController.deleteCliente); //verifyToken

module.exports = router;