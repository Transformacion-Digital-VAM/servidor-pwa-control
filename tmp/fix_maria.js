const mongoose = require('mongoose');
require('dotenv').config({ path: 'variables.env' });
const connectDB = require('./config/db');
const Credito = require('./models/Credito');
const Cliente = require('./models/Cliente');
const Miembro = require('./models/Miembro');

(async () => {
    try {
        await connectDB();
        console.log('Connected to DB');

        const query = { nombre: /MARIA/i, apellidos: /GARCIA/i };
        const cliente = await Cliente.findOne(query);
        const miembro = await Miembro.findOne(query);

        let targetCredito;
        if (cliente) {
            targetCredito = await Credito.findOne({ cliente: cliente._id, estado: 'Activo' });
        }
        if (!targetCredito && miembro) {
            targetCredito = await Credito.findOne({ miembro: miembro._id, estado: 'Activo' });
        }

        if (!targetCredito) {
            console.log('No active credit found for Maria Garcia');
            process.exit(1);
        }

        console.log('Found credit:', targetCredito._id);
        console.log('Number of payments:', targetCredito.pagos.length);

        const hoy = new Date();
        const hoyStr = hoy.toDateString();

        let firstSameDayPagoIndex = -1;
        let firstSameDayNumeroPago = -1;

        for (let i = 0; i < targetCredito.pagos.length; i++) {
            const p = targetCredito.pagos[i];
            const pDate = new Date(p.fechaPago).toDateString();
            if (pDate === hoyStr) {
                if (firstSameDayPagoIndex === -1) {
                    firstSameDayPagoIndex = i;
                    firstSameDayNumeroPago = p.numeroPago;
                } else {
                    // Update this payment's numeroPago to match the first one of the day
                    targetCredito.pagos[i].numeroPago = firstSameDayNumeroPago;
                }
            }
        }

        if (firstSameDayPagoIndex !== -1) {
            await targetCredito.save();
            console.log('Payments merged for Maria Garcia today');
        } else {
            console.log('No payments found for today for Maria Garcia');
        }

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
})();
