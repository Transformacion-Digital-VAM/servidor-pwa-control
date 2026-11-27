/**
 * Script seguro para deduplicar miembros repetidos en MongoDB y limpiar Grupo.integrantes.
 *
 * Uso:
 *   node scripts/deduplicar_miembros.js            -> Modo simulación (dry-run, NO modifica nada)
 *   node scripts/deduplicar_miembros.js --confirm  -> Ejecuta la limpieza en MongoDB
 */
const fs = require('fs');
const path = require('path');

if (fs.existsSync(path.join(__dirname, '..', 'variables.env'))) {
    require('dotenv').config({ path: path.join(__dirname, '..', 'variables.env') });
} else {
    require('dotenv').config();
}

const connectDB = require('../config/db');
const Miembro = require('../models/Miembro');
const Grupo = require('../models/Grupo');
const Credito = require('../models/Credito');

const isConfirm = process.argv.includes('--confirm');

async function main() {
    await connectDB();
    console.log(`\nModo: ${isConfirm ? 'EJECUCIÓN REAL (--confirm)' : 'SIMULACIÓN (dry-run, sin cambios)'}\n`);

    // 1. Obtener todos los miembro IDs referenciados por algún Crédito (titular o solidarios)
    const [creditosMiembroIds, prestadoresIds, beneficiariosIds] = await Promise.all([
        Credito.distinct('miembro', { miembro: { $ne: null } }),
        Credito.distinct('pagos.quienPrestoSolidario', { 'pagos.quienPrestoSolidario': { $ne: null } }),
        Credito.distinct('pagos.beneficiariosSolidarios.miembro', { 'pagos.beneficiariosSolidarios.miembro': { $ne: null } })
    ]);
    const miembrosConCreditoSet = new Set([
        ...creditosMiembroIds.map(id => String(id)),
        ...prestadoresIds.map(id => String(id)),
        ...beneficiariosIds.map(id => String(id))
    ]);
    console.log(`Miembros referenciados por algún Crédito (titular o solidario): ${miembrosConCreditoSet.size}`);

    // 2. Cargar todos los miembros (solo campos necesarios para agrupar)
    const todosMiembros = await Miembro.find({})
        .select('_id nombre apellidos grupo rol ciclo createdAt')
        .sort({ createdAt: 1 })
        .lean();
    console.log(`Total de documentos Miembro en BD: ${todosMiembros.length}`);

    // 3. Agrupar por (grupo + nombre normalizado + apellidos normalizado)
    const gruposClave = new Map();
    const miembrosSinDeduplicar = [];
    for (const m of todosMiembros) {
        const nKey = String(m.nombre || '').trim().toUpperCase().replace(/\s+/g, ' ');
        const aKey = String(m.apellidos || '').trim().toUpperCase().replace(/\s+/g, ' ');
        if (!m.grupo || (!nKey && !aKey)) {
            miembrosSinDeduplicar.push(m);
            continue;
        }
        const key = `${String(m.grupo)}::${nKey}::${aKey}`;

        if (!gruposClave.has(key)) {
            gruposClave.set(key, []);
        }
        gruposClave.get(key).push(m);
    }

    const idsAEliminar = [];
    const idsConservadosPorGrupo = new Map(); // grupoId -> Set<ObjectId>
    let conservadosSinCredito = 0;

    for (const m of miembrosSinDeduplicar) {
        if (m.grupo) {
            const gStr = String(m.grupo);
            if (!idsConservadosPorGrupo.has(gStr)) idsConservadosPorGrupo.set(gStr, new Set());
            idsConservadosPorGrupo.get(gStr).add(m._id);
        }
    }

    for (const [, lista] of gruposClave.entries()) {
        // Conservar:
        // - Todos los que tengan un crédito asociado (titular o solidario)
        // - Si ninguno tiene crédito, conservar el más antiguo (lista[0]) para no perder miembros reales sin crédito
        const conCredito = lista.filter(m => miembrosConCreditoSet.has(String(m._id)));
        const aConservar = conCredito.length > 0 ? conCredito : [lista[0]];
        if (conCredito.length === 0) conservadosSinCredito++;
        const conservarSet = new Set(aConservar.map(m => String(m._id)));

        for (const m of lista) {
            const idStr = String(m._id);
            if (conservarSet.has(idStr)) {
                if (m.grupo) {
                    const gStr = String(m.grupo);
                    if (!idsConservadosPorGrupo.has(gStr)) {
                        idsConservadosPorGrupo.set(gStr, new Set());
                    }
                    idsConservadosPorGrupo.get(gStr).add(m._id);
                }
            } else {
                // Doble seguro: nunca eliminar si está en miembrosConCreditoSet
                if (!miembrosConCreditoSet.has(idStr)) {
                    idsAEliminar.push(m._id);
                }
            }
        }
    }

    console.log(`Claves únicas (grupo + nombre + apellidos): ${gruposClave.size}`);
    console.log(`Miembros a CONSERVAR: ${todosMiembros.length - idsAEliminar.length} (incluye ${conservadosSinCredito} miembros únicos sin crédito aún)`);
    console.log(`Miembros duplicados sin crédito a ELIMINAR: ${idsAEliminar.length}`);

    if (!isConfirm) {
        console.log('\n[DRY-RUN] No se modificó ningún dato.');
        console.log('Para ejecutar la limpieza real, corre:');
        console.log('  node scripts/deduplicar_miembros.js --confirm\n');
        process.exit(0);
    }

    if (idsAEliminar.length === 0) {
        console.log('\nNo hay duplicados que eliminar.');
        process.exit(0);
    }

    // 4. Eliminar duplicados en lotes de 1000
    const BATCH_SIZE = 1000;
    let eliminados = 0;
    for (let i = 0; i < idsAEliminar.length; i += BATCH_SIZE) {
        const batch = idsAEliminar.slice(i, i + BATCH_SIZE);
        const res = await Miembro.deleteMany({ _id: { $in: batch } });
        eliminados += res.deletedCount || 0;
        console.log(`Eliminados ${eliminados} / ${idsAEliminar.length}...`);
    }

    // 5. Sincronizar Grupo.integrantes con los IDs conservados
    const todosGrupos = await Grupo.find({}).select('_id integrantes').lean();
    const bulkOps = [];
    for (const g of todosGrupos) {
        const gStr = String(g._id);
        const conservadosSet = idsConservadosPorGrupo.get(gStr) || new Set();
        const nuevosIntegrantes = Array.from(conservadosSet);
        const actualLen = Array.isArray(g.integrantes) ? g.integrantes.length : 0;

        if (actualLen !== nuevosIntegrantes.length) {
            bulkOps.push({
                updateOne: {
                    filter: { _id: g._id },
                    update: { $set: { integrantes: nuevosIntegrantes } }
                }
            });
        }
    }

    if (bulkOps.length > 0) {
        await Grupo.bulkWrite(bulkOps);
        console.log(`Actualizados ${bulkOps.length} grupos (Grupo.integrantes limpiado).`);
    }

    console.log('\nLimpieza completada con éxito.');
    process.exit(0);
}

main().catch(err => {
    console.error('Error en deduplicar_miembros:', err);
    process.exit(1);
});
