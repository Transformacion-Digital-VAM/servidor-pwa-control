const express = require('express');
const router = express.Router();
const creditoController = require('../controllers/credito.controller');
const pagoCreditoController = require('../controllers/pagoCredito.controller');
const ahorroGarantiaController = require('../controllers/ahorroGarantia.controller');
const hcontrolController = require('../controllers/hcontrol.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

// CRUD Créditos
router.post('/', creditoController.crearCredito); //verifyToken
router.get('/', creditoController.obtenerCreditos); //verifyToken
router.get('/pagos-con-ubicacion', pagoCreditoController.getPagosConUbicacion); //verifyToken — ANTES de /:id
router.get('/:id', creditoController.obtenerCreditoPorId); //verifyToken
router.put('/:id', creditoController.actualizarCredito); //verifyToken
router.put('/:id/cancelar-justificado', creditoController.cancelarCreditoJustificado); //verifyToken
router.delete('/:id', creditoController.eliminarCredito); //verifyToken

// Pagos
router.post('/:id/pagos', pagoCreditoController.registrarPago); //verifyToken

// Garantías y Ahorro
router.post('/:id/garantia', ahorroGarantiaController.registrarAbonoGarantia); //verifyToken
router.post('/:id/ahorro', ahorroGarantiaController.registrarAhorro); //verifyToken

// Hoja de control
router.get('/hoja-control/:grupoId/:ciclo', hcontrolController.generarHojaControlGrupal); //verifyToken
router.get('/hoja-control-individual/:clienteId/:ciclo', hcontrolController.generarHojaControlIndividual); //verifyToken

module.exports = router;
