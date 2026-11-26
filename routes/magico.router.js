const express = require('express');
const router = express.Router();
const magicoController = require('../controllers/magico.controller');
const magicoHControlController = require('../controllers/magicoHControl.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

// Rutas específicas (antes de /:id)
router.get('/elegibilidad/:grupoId', verifyToken, magicoController.obtenerElegibilidadGrupo);
router.get('/grupo/:grupoId', verifyToken, magicoController.obtenerHojaGrupoMagicos);
router.get('/hoja-control/:grupoId', magicoHControlController.generarHojaControlMagicos);
router.post('/pagos-grupo', verifyToken, magicoController.registrarPagosGrupoMagicos);

// CRUD y pagos
router.post('/', verifyToken, magicoController.crearCreditosMagicos);
router.get('/', verifyToken, magicoController.obtenerCreditosMagicos);
router.get('/:id', verifyToken, magicoController.obtenerCreditoMagicoPorId);
router.post('/:id/pagos', verifyToken, magicoController.registrarPagoMagico);
router.put('/:id/cancelar', verifyToken, magicoController.cancelarCreditoMagico);

module.exports = router;

