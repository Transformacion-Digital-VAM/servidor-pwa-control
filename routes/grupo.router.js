const express = require('express');
const router = express.Router();
const coordinacionController = require('../controllers/coordinacion.controller');
const grupoController = require('../controllers/grupo.controller');
const { verifyToken } = require('../middlewares/auth.middleware');

// GRUPOS
router.post('/create', verifyToken, grupoController.createGrupo); //verifyToken
router.get('/get', verifyToken, grupoController.getGrupos); //verifyToken
router.get('/get/:id', verifyToken, grupoController.getGrupoById); //verifyToken
// obtener grupos por coordinacion
router.get('/get/coordinacion/:coordinacion', verifyToken, grupoController.getGruposPorCoordinacion); //verifyToken
// obtener grupos por asesor
router.get('/get/asesor/:asesor', verifyToken, grupoController.getGruposPorAsesor); //verifyToken
router.put('/update/:id', verifyToken, grupoController.updateGrupo); //verifyToken
router.delete('/delete/:id', verifyToken, grupoController.deleteGrupo); //verifyToken


//----------------------------------------------------------------------------------------------------
// COORDINACION
router.get('/coordinacion', coordinacionController.obtenerCoordinacion); //verifyToken
router.post('/coordinacion', coordinacionController.crearCoordinacion); //verifyToken


//----------------------------------------------------------------------------------------------------
//ASESORES
router.get('/asesores', coordinacionController.obtenerAsesores); //verifyToken
router.get('/asesores/:coordinacion', coordinacionController.obtenerAsesoresCoordinacion); //verifyToken



module.exports = router;