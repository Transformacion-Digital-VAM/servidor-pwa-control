const express = require('express');
const router = express.Router();
const coordinacionController = require('../controllers/coordinacion.controller');
const grupoController = require('../controllers/grupo.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

router.post('/create', verifyToken, grupoController.createGrupo);
router.get('/get', verifyToken, grupoController.getGrupos);
router.get('/get/:id', verifyToken, grupoController.getGrupoById);
router.put('/update/:id', verifyToken, grupoController.updateGrupo);
router.delete('/delete/:id', verifyToken, grupoController.deleteGrupo);

// COORDINACION
router.get('/coordinacion', verifyToken, coordinacionController.obtenerCoordinacion);
router.post('/coordinacion', verifyToken, coordinacionController.crearCoordinacion);

//ASESORES
router.get('/asesores', verifyToken, coordinacionController.obtenerAsesores);
router.get('/asesores/:coordinacion', verifyToken, coordinacionController.obtenerAsesoresCoordinacion);
module.exports = router;