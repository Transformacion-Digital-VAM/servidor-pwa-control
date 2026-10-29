function generarCalendarioPagos(fechaPrimerPago, semanas, frecuenciaPago = 'Semanal', diaPago = null) {
    const fechas = [];
    const baseDate = new Date(fechaPrimerPago);
    const frec = (frecuenciaPago || 'Semanal').toLowerCase();

    let diaMesPactado = null;
    if (diaPago) {
        const m = String(diaPago).match(/\b(\d{1,2})\b/);
        if (m) {
            const num = parseInt(m[1], 10);
            if (num >= 1 && num <= 31) diaMesPactado = num;
        }
    }
    const esMensual = frec === 'mensual' || diaMesPactado !== null;
    const targetDay = diaMesPactado !== null ? diaMesPactado : baseDate.getDate();

    for (let i = 0; i < semanas; i++) {
        let nuevaFecha;
        if (esMensual) {
            const temp = new Date(baseDate.getFullYear(), baseDate.getMonth() + i, 1);
            const diasEnMes = new Date(temp.getFullYear(), temp.getMonth() + 1, 0).getDate();
            temp.setDate(Math.min(targetDay, diasEnMes));
            if (temp.getDay() === 0) {
                temp.setDate(temp.getDate() - 1);
            }
            nuevaFecha = temp;
        } else if (frec === 'bisemanal') {
            nuevaFecha = new Date(baseDate);
            nuevaFecha.setDate(baseDate.getDate() + (i * 14));
            if (nuevaFecha.getDay() === 0) nuevaFecha.setDate(nuevaFecha.getDate() - 1);
        } else if (frec === 'quincenal') {
            nuevaFecha = new Date(baseDate);
            nuevaFecha.setDate(baseDate.getDate() + (i * 15));
            if (nuevaFecha.getDay() === 0) nuevaFecha.setDate(nuevaFecha.getDate() - 1);
        } else {
            nuevaFecha = new Date(baseDate);
            nuevaFecha.setDate(baseDate.getDate() + (i * 7));
            if (nuevaFecha.getDay() === 0) nuevaFecha.setDate(nuevaFecha.getDate() - 1);
        }

        fechas.push({
            numeroPago: i + 1,
            fechaProgramada: nuevaFecha
        });
    }

    return fechas;
}

module.exports = { generarCalendarioPagos };