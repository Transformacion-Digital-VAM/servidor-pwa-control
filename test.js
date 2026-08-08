const mongoose = require('mongoose');
const Credito = require('./models/Credito');
const Grupo = require('./models/Grupo');

const uri = 'mongodb+srv://tdsoportevam_db_user:N7BJybBYi4T3pjtf@vam2026.kaydypd.mongodb.net/db_control_vam';

mongoose.connect(uri).then(async () => {
    try {
        const creditosInd = await Credito.find({ tipoCredito: 'Individual' }).populate('cliente').limit(50);
        console.log('--- Buscando Grupos ---');
        let matched = 0;
        for (const cred of creditosInd) {
            if (cred.cliente && cred.cliente.grupo && cred.cliente.grupo.trim() !== '' && cred.cliente.grupo !== 'N/A') {
                const nombreGrupo = cred.cliente.grupo.trim();
                const grupo = await Grupo.findOne({ nombre: new RegExp('^' + nombreGrupo + '$', 'i') });
                console.log(`Cliente: ${cred.cliente.nombre}, Grupo string: "${nombreGrupo}" -> Match en BD: ${grupo ? grupo.nombre : 'NO ENCONTRADO'}`);
                if (grupo) matched++;
            }
        }
        console.log(`Total matched: ${matched}`);
    } catch(e) { console.error(e); }
    process.exit(0);
});
