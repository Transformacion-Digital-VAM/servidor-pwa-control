const express = require('express');
const router = express.Router();
const grupoController = require('../controllers/grupo.controller');

router.post('/create', grupoController.createGrupo);
router.get('/get', grupoController.getGrupos);
router.get('/get/:id', grupoController.getGrupoById);
router.put('/update/:id', grupoController.updateGrupo);
router.delete('/delete/:id', grupoController.deleteGrupo);

module.exports = router;