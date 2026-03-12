const express = require('express');
const router = express.Router();
const clienteController = require('../controllers/cliente.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

router.post('/', clienteController.createCliente); //verifyToken
router.get('/', clienteController.getCliente); //verifyToken
router.get('/:id', clienteController.getClientePorId); // verifyToken
router.put('/:id', clienteController.updateCliente); // verifyToken
router.delete('/:id', clienteController.deleteCliente); // verifyToken

module.exports = router;