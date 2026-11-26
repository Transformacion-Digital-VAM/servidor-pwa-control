const express = require('express');
const router = express.Router();
const creditoController = require('../controllers/credito.controller');
const hcontrolController = require('../controllers/hcontrol.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

router.post('/', verifyToken, creditoController.crearCredito);
router.get('/', verifyToken, creditoController.obtenerCreditos);
router.get('/pagos-con-ubicacion', verifyToken, creditoController.getPagosConUbicacion); // ANTES de /:id
router.get('/:id', verifyToken, creditoController.obtenerCreditoPorId);
router.put('/:id', verifyToken, creditoController.actualizarCredito);
router.put('/:id/cancelar-justificado', verifyToken, creditoController.cancelarCreditoJustificado);
router.delete('/:id', verifyToken, creditoController.eliminarCredito);

// PAGOS
router.post('/:id/pagos', verifyToken, creditoController.registrarPago);
// router.post('/:id/refill', verifyToken, creditoController.convertirARefill);
router.post('/:id/garantia', verifyToken, creditoController.registrarAbonoGarantia);


//GARANTIAS
//router.post('/:id/garantia', verifyToken, creditoController.registrarGarantia);


//AHORRO
router.post('/:id/ahorro', verifyToken, creditoController.registrarAhorro);


//Hoja de control
router.get('/hoja-control/:grupoId/:ciclo', hcontrolController.generarHojaControlGrupal); //verifyToken
router.get('/hoja-control-individual/:clienteId/:ciclo', hcontrolController.generarHojaControlIndividual); //verifyToken
module.exports = router;