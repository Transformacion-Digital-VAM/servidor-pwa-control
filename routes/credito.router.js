const express = require('express');
const router = express.Router();
const creditoController = require('../controllers/credito.controller');
const hcontrolController = require('../controllers/hcontrol.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

router.post('/', creditoController.crearCredito); //verifyToken
router.get('/', creditoController.obtenerCreditos); //verifyToken
router.get('/:id', creditoController.obtenerCreditoPorId); //verifyToken
router.put('/:id', creditoController.actualizarCredito); //verifyToken
router.delete('/:id', creditoController.eliminarCredito); //verifyToken

// PAGOS
router.post('/:id/pagos', creditoController.registrarPago); //verifyToken
router.post('/:id/garantia', creditoController.registrarAbonoGarantia); //verifyToken


//GARANTIAS
//router.post('/:id/garantia', creditoController.registrarGarantia); //verifyToken


//AHORRO
router.post('/:id/ahorro', creditoController.registrarAhorro); //verifyToken


//Hoja de control
router.get('/hoja-control/:grupoId/:ciclo', hcontrolController.generarHojaControlGrupal); //verifyToken
router.get('/hoja-control-individual/:clienteId/:ciclo', hcontrolController.generarHojaControlIndividual); //verifyToken
module.exports = router;