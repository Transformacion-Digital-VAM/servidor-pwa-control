const express = require('express');
const router = express.Router();
const creditoController = require('../controllers/credito.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

router.post('/', verifyToken, creditoController.crearCredito);
router.get('/', verifyToken, creditoController.obtenerCreditos);
router.get('/:id', verifyToken, creditoController.obtenerCreditoPorId);
router.put('/:id', verifyToken, creditoController.actualizarCredito);
router.delete('/:id', verifyToken, creditoController.eliminarCredito);

// PAGOS
router.post('/:id/pagos', verifyToken, creditoController.registrarPago);

router.get('/hoja-control/:grupoId/:ciclo', verifyToken, creditoController.hojaControl);
module.exports = router;