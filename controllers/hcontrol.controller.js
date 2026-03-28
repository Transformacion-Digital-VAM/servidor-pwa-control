const Credito = require('../models/Credito');
const Miembro = require('../models/Miembro');
const Grupo = require('../models/Grupo');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Instancia global de Puppeteer para reutilización
let _browser;
const getBrowser = async () => {
    if (!_browser || !_browser.connected) {
        console.log('[Puppeteer] Iniciando instancia del navegador...');

        const options = {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        };

        // Búsqueda dinámica de Chrome en Render o local
        const possibleCacheDirs = [
            path.join(process.cwd(), '.puppeteer-cache'),
            process.env.PUPPETEER_CACHE_DIR,
            '/opt/render/.cache/puppeteer'
        ].filter(Boolean);

        console.log(`[Puppeteer] Buscando Chrome en: ${possibleCacheDirs.join(', ')}`);

        for (const cacheDir of possibleCacheDirs) {
            try {
                if (fs.existsSync(cacheDir)) {
                    // Función recursiva simple para encontrar el ejecutable 'chrome'
                    const findChrome = (dir) => {
                        const files = fs.readdirSync(dir);
                        for (const file of files) {
                            const fullPath = path.join(dir, file);
                            const stat = fs.statSync(fullPath);
                            if (stat.isDirectory()) {
                                const found = findChrome(fullPath);
                                if (found) return found;
                            } else if ((file === 'chrome' || file === 'chromium') && (stat.mode & 0o111)) {
                                return fullPath;
                            }
                        }
                        return null;
                    };

                    const executablePath = findChrome(cacheDir);
                    if (executablePath) {
                        console.log('[Puppeteer] Ejecutable encontrado dinámicamente:', executablePath);
                        options.executablePath = executablePath;
                        break; // Encontrado, salir del loop
                    }
                }
            } catch (err) {
                console.error(`[Puppeteer] Error buscando en ${cacheDir}:`, err.message);
            }
        }


        try {
            _browser = await puppeteer.launch(options);
            console.log('[Puppeteer] Navegador iniciado correctamente.');
        } catch (error) {
            console.error('[Puppeteer] Error al iniciar navegador:', error.message);
            // Si falla, volver a intentar
            if (options.executablePath) {
                console.log('[Puppeteer] Reintentando sin executablePath explícito...');
                delete options.executablePath;
                _browser = await puppeteer.launch(options);
            } else {
                throw error;
            }
        }
    }
    return _browser;
};



exports.generarHojaControlGrupal = async (req, res) => {
    const { grupoId, ciclo } = req.params;

    try {
        // 1. OBTENER MIEMBROS DEL GRUPO
        const miembros = await Miembro.find({ grupo: grupoId });
        const miembrosIds = miembros.map(m => m._id);

        if (miembrosIds.length === 0) {
            return res.status(404).json({ message: "No se encontraron miembros para este grupo" });
        }

        // 2. OBTENER CRÉDITOS PARA ESE CICLO Y MIEMBROS
        const creditos = await Credito.find({
            miembro: { $in: miembrosIds },
            ciclo: ciclo
        })
            .populate({
                path: 'miembro',
                populate: { path: 'grupo' }
            })
            .populate('cliente');

        if (creditos.length === 0) {
            return res.status(404).json({ message: "No se encontraron créditos para este grupo en el ciclo especificado" });
        }

        // 3. FUNCIONES DE APOYO
        const formatoMoneda = (num) =>
            Number(num).toLocaleString('es-MX', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });

        const generarCalendario = (fechaInicio, semanas, isRefill = false) => {
            const fechas = [];
            const base = new Date(fechaInicio);
            // Desfase de zona horaria
            base.setMinutes(base.getMinutes() + base.getTimezoneOffset());

            const frec = (creditosSubGrupo.length > 0 && creditosSubGrupo[0].frecuenciaPago) ? creditosSubGrupo[0].frecuenciaPago.toLowerCase() : 'semanal';

            for (let i = 0; i < semanas; i++) {
                let nueva;
                if (frec === 'mensual') {
                    const temp = new Date(base);
                    const targetDay = temp.getDate();
                    temp.setMonth(temp.getMonth() + i);
                    if (temp.getDate() !== targetDay) { temp.setDate(0); }
                    nueva = temp;
                } else if (frec === 'quincenal') {
                    nueva = new Date(base);
                    nueva.setDate(base.getDate() + (i * 15));
                } else if (frec === 'bisemanal') {
                    nueva = new Date(base);
                    nueva.setDate(base.getDate() + (i * 14));
                } else {
                    nueva = new Date(base);
                    nueva.setDate(base.getDate() + (i * 7));
                }

                fechas.push({
                    numero: isRefill ? i + 9 : i + 1,
                    fecha: nueva.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' })
                });
            }
            return fechas;
        };


        const creditosNormales = creditos.filter(c => c.tipoCredito !== 'R');
        const creditosRefill = creditos.filter(c => c.tipoCredito === 'R');

        let gruposCreditos = [];
        if (creditosNormales.length > 0) gruposCreditos.push(creditosNormales);
        if (creditosRefill.length > 0) gruposCreditos.push(creditosRefill);

        const templatePath = path.join(__dirname, '../templates/hojaControl.html');
        let htmlCompletoOrigin = fs.readFileSync(templatePath, 'utf8');

        let bodyMatch = htmlCompletoOrigin.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        let bodyTemplate = bodyMatch ? bodyMatch[1] : '';

        let finalBodies = [];

        for (let sub = 0; sub < gruposCreditos.length; sub++) {
            const creditosSubGrupo = gruposCreditos[sub];

            // 4. GENERAR TABLA PRINCIPAL (control de pagos)
            let sumaPagoPactado = 0;
            let sumaSaldoTotal = 0;
            let maxSemanas = 16;
            if (creditosSubGrupo.length > 0 && creditosSubGrupo[0].semanas) {
                maxSemanas = creditosSubGrupo[0].semanas;
            }

            const llena = req.query.llena === 'true';
            const sumasSemanalesMod = new Array(maxSemanas).fill(0);

            const esRefill = creditosSubGrupo.length > 0 && creditosSubGrupo[0].tipoCredito === 'R';
            const fechaBasica = creditosSubGrupo.length > 0 ? creditosSubGrupo[0].fechaPrimerPago : new Date();
            const calendario = generarCalendario(fechaBasica, maxSemanas, esRefill);

            let tablaThead = `<tr>
            <th rowspan="2" width="2%">NO.</th>
            <th rowspan="2" width="4%" style="font-size:9px;">TIPO DE<br>CRÉDITO</th>
            <th rowspan="2" width="14%">NOMBRE DEL<br>CLIENTE</th>
            <th rowspan="2" width="7%">PAGO<br>PACTADO</th>`;

            calendario.forEach(p => {
                tablaThead += `<th width="4%" style="font-size:9px;">SEM ${p.numero}</th>`;
            });
            tablaThead += `<th rowspan="2" width="4%">S.F.</th></tr><tr>`;
            calendario.forEach(p => {
                tablaThead += `<th style="font-size: 8px;">${p.fecha}</th>`;
            });
            tablaThead += `</tr>`;

            let tablaTbody = '';

            creditosSubGrupo.forEach((credito, index) => {
                const nombreCliente = credito.cliente
                    ? `${credito.cliente.nombre} ${credito.cliente.apellidos}`
                    : credito.miembro
                        ? `${credito.miembro.nombre} ${credito.miembro.apellidos}`
                        : "N/A";

                const tipoCredito = credito.tipoCredito || "C.C.";
                const pagoPactado = credito.pagoPactado || 0;
                const saldoTotal = credito.saldoTotal || 0;

                sumaPagoPactado += pagoPactado;
                sumaSaldoTotal += saldoTotal;

                // Fila A del miembro (Nombre y Pago)
                tablaTbody += `
                <tr>
                    <td rowspan="2" align="center" style="font-weight:bold;">${index + 1}</td>
                    <td align="center" style="font-size:9px; font-weight:bold;">${tipoCredito}</td>
                    <td align="center" style="font-size:10px; font-weight:bold; text-transform:uppercase;">${nombreCliente}</td>
                    <td rowspan="2" style="font-size:11px;">
                        <div style="display: flex; justify-content: space-between; width: 100%;">
                            <span>$</span>
                            <span>${formatoMoneda(pagoPactado)}</span>
                        </div>
                    </td>
            `;
                for (let w = 0; w < maxSemanas; w++) {
                    let valorCelda = '';
                    let tdBgStyle = '';
                    if (llena && credito.pagos) {
                        // Agrupar todos los pagos de esa misma semana (numeroPago)
                        const pagosSemana = credito.pagos.filter(p => p.numeroPago === w + 1);

                        if (pagosSemana.length > 0) {
                            const montoTotalSemana = pagosSemana.reduce((acc, p) => acc + p.montoPagado, 0);
                            // Usar la fecha del primer pago de esa semana
                            const fechaSemanaObj = new Date(pagosSemana[0].fechaPago);
                            // zona horaria
                            fechaSemanaObj.setMinutes(fechaSemanaObj.getMinutes() + fechaSemanaObj.getTimezoneOffset());

                            const esAbonoSolidario = pagosSemana.some(p => p.pagoSolidario === true);
                            tdBgStyle = esAbonoSolidario ? 'background-color: #ffedd5;' : '';
                            let textColor = esAbonoSolidario ? 'color: #c2410c;' : 'color: #2563eb;';
                            let dateColor = esAbonoSolidario ? 'color: #ea580c;' : 'color: #666;';

                            valorCelda = `<div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%;">
                                        <span style="font-size: 7px; ${dateColor}">${fechaSemanaObj.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' })}</span>
                                        <span style="font-weight: bold; font-size: 10px; ${textColor}">${formatoMoneda(montoTotalSemana)}</span>
                                      </div>`;
                            sumasSemanalesMod[w] += montoTotalSemana;
                        }
                    }
                    tablaTbody += `<td rowspan="2" align="center" style="vertical-align: middle; padding:0; ${tdBgStyle}">${valorCelda}</td>`;
                }
                let sfVal = '';
                if (llena) sfVal = `${formatoMoneda(credito.saldoPendiente)}`;
                tablaTbody += `<td rowspan="2" align="center" style="font-size:10px; font-weight:bold;">${sfVal}</td></tr>`;

                // Fila B del miembro (S.T. / Saldo)
                tablaTbody += `
                <tr>
                    <td align="center" style="font-size:9px; font-weight:bold;">S.T.</td>
                    <td style="font-size: 11px; padding: 0 5px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                            <span>$</span>
                            <span>${formatoMoneda(saldoTotal)}</span>
                        </div>
                    </td>
                </tr>
            `;
            });

            // Totales - P.P.G.
            tablaTbody += `
            <tr>
                <td colspan="3" align="center" style="font-weight:bold; font-size:11px; padding: 6px 0;">P.P.G.</td>
                <td style="font-weight:bold; font-size:11px;">
                    <div style="display:flex; justify-content:space-between; width:100%;">
                        <span>$</span><span>${formatoMoneda(sumaPagoPactado)}</span>
                    </div>
                </td>
        `;
            for (let w = 0; w < maxSemanas; w++) {
                let val = llena && sumasSemanalesMod[w] > 0 ? `${formatoMoneda(sumasSemanalesMod[w])}` : '';
                tablaTbody += `<td align="center" style="font-weight:bold; font-size:10px;">${val}</td>`;
            }
            let sfTotal = llena ? `${formatoMoneda(sumaSaldoTotal - sumasSemanalesMod.reduce((a, b) => a + b, 0))}` : '';
            tablaTbody += `<td align="center" style="font-weight:bold; font-size:10px; color: #b91c1c;">${sfTotal}</td></tr>`;

            // S.I. / S.S.
            tablaTbody += `
            <tr>
                <td colspan="4" align="center" style="font-weight:bold; font-size:11px;">S.I.</td>
        `;
            for (let w = 0; w < maxSemanas; w++) {
                tablaTbody += `<td align="center" style="font-weight:bold; font-size:10px;">S.S.</td>`;
            }
            tablaTbody += `<td align="center" style="font-weight:bold; font-size:11px;">S.F.</td></tr>`;

            // Fila Símbolo Pesos Final y Monto (Saldo Decreciente)
            tablaTbody += `
            <tr>
                <td colspan="4" align="right" style="font-weight:bold; font-size:12px; padding-right:10px;"><span>$</span>${formatoMoneda(sumaSaldoTotal)}</td>
        `;
            let saldoAcumulado = sumaSaldoTotal;
            for (let w = 0; w < maxSemanas; w++) {
                saldoAcumulado -= sumasSemanalesMod[w];
                let val = (llena && sumasSemanalesMod[w] > 0) ? `${formatoMoneda(saldoAcumulado)}` : '';
                tablaTbody += `<td align="center" style="font-weight:bold; font-size:10px;">${val}</td>`;
            }
            tablaTbody += `<td></td></tr>`;

            // Obtener datos del grupo del primer credito para la cabecera
            const unCredito = creditosSubGrupo[0];
            const grupo = unCredito?.miembro?.grupo;
            const grupoNombre = grupo?.nombre || "INDIVIDUAL";
            const diaVisita = grupo?.diaVisita || "________________";
            const horaVisita = grupo?.horaVisita || "________________";        // TABLA 2: INCREMENTO DE GARANTÍA
            let tablaIncrementoThead = `
            <tr>
                <th colspan="${4 + maxSemanas + 1}" align="center" style="font-size:12px; font-weight:bold; color: #000; padding: 5px;">INCREMENTO DE GTIA.</th>
            </tr>
            <tr>
                <th width="2%">NO.</th>
                <th width="8%">CARGO</th>
                <th width="10%">GARANTIA<br>INICIAL</th>
                <th width="14%">NOMBRE DEL CLIENTE</th>`;
            for (let w = 1; w <= maxSemanas; w++) {
                const lbl = esRefill ? w + 8 : w;
                tablaIncrementoThead += `<th width="4%" style="font-size:9px;">SEM ${lbl}</th>`;
            }
            tablaIncrementoThead += `<th width="4%">GTIA.<br>FINAL</th></tr>`;

            let tablaIncrementoTbody = '';
            let sumaGarantiaInicial = 0;
            creditosSubGrupo.forEach((credito, index) => {
                const nombreCliente = credito.cliente
                    ? `${credito.cliente.nombre} ${credito.cliente.apellidos}`
                    : credito.miembro
                        ? `${credito.miembro.nombre} ${credito.miembro.apellidos}`
                        : "N/A";

                let cargo = "INTEGRANTE";
                if (credito.miembro && credito.miembro.rol) cargo = credito.miembro.rol.toUpperCase();

                const garantiaInicial = credito.garantia || 0;
                sumaGarantiaInicial += garantiaInicial;

                tablaIncrementoTbody += `
                <tr>
                    <td align="center" style="font-weight:bold;">${index + 1}</td>
                    <td align="center" style="font-size:9px; font-weight:bold;">${cargo}</td>
                    <td align="center" style="font-size:11px;">$ ${formatoMoneda(garantiaInicial)}</td>
                    <td align="center" style="font-size:10px; font-weight:bold; text-transform:uppercase;">${nombreCliente}</td>
            `;
                for (let w = 1; w <= maxSemanas; w++) {
                    let label = esRefill ? w + 8 : w;
                    let bgStyle = (label >= 14) ? 'background-color: #dbe5f1;' : '';
                    let valorCelda = '';
                    if (llena && credito.ahorro && credito.ahorro.pagosAhorro) {
                        const ahorro = credito.ahorro.pagosAhorro[w - 1];
                        if (ahorro && ahorro.monto > 0) {
                            valorCelda = `${formatoMoneda(ahorro.monto)}`;
                        }
                    }
                    tablaIncrementoTbody += `<td align="center" style="${bgStyle} font-size:10px; font-weight:bold; color: #059669;">${valorCelda}</td>`;
                }
                let totalAhorro = garantiaInicial;
                if (llena && credito.ahorro) {
                    totalAhorro += (credito.ahorro.montoTotal || 0);
                }
                let finalVal = llena ? `${formatoMoneda(totalAhorro)}` : '$ ';
                tablaIncrementoTbody += `<td align="left" style="font-weight:bold; font-size:10px;">${finalVal}</td></tr>`;
            });

            // Total Incremento
            tablaIncrementoTbody += `
            <tr>
                <td colspan="2" align="center" style="font-weight:bold; font-size:9px; padding: 5px 0;">TOTAL<br>GARANTIA<br>INICIAL</td>
                <td align="center" style="font-weight:bold; font-size:11px;">$ ${formatoMoneda(sumaGarantiaInicial)}</td>
                <td align="right" style="font-weight:bold; padding-right:10px;">TOTAL</td>
        `;
            for (let w = 1; w <= maxSemanas; w++) {
                let label = esRefill ? w + 8 : w;
                let bgStyle = (label >= 14) ? 'background-color: #dbe5f1;' : '';
                tablaIncrementoTbody += `<td align="left" style="${bgStyle} font-weight:bold; font-size:10px;">$ </td>`;
            }
            tablaIncrementoTbody += `<td align="left" style="font-weight:bold; font-size:10px;">$ </td></tr>`;

            // TABLA 3: REGISTRO DE SOLIDARIOS
            let tablaSolidariosThead = `
            <tr>
                <th colspan="${3 + maxSemanas + 1}" align="center" style="font-size:12px; font-weight:bold; color: #000; padding: 5px;">REGISTRO DE SOLIDARIOS</th>
            </tr>
            <tr>
                <th width="2%">NO.</th>
                <th width="8%">CARGO</th>
                <th width="14%">NOMBRE DEL CLIENTE</th>`;
            for (let w = 1; w <= maxSemanas; w++) {
                const lbl = esRefill ? w + 8 : w;
                tablaSolidariosThead += `<th width="4%" style="font-size:9px;">SEM ${lbl}</th>`;
            }
            tablaSolidariosThead += `<th width="4%">TOTAL</th></tr>`;

            let tablaSolidariosTbody = '';
            creditosSubGrupo.forEach((credito, index) => {
                const nombreCliente = credito.cliente
                    ? `${credito.cliente.nombre} ${credito.cliente.apellidos}`
                    : credito.miembro
                        ? `${credito.miembro.nombre} ${credito.miembro.apellidos}`
                        : "N/A";

                let cargo = "INTEGRANTE";
                if (credito.miembro && credito.miembro.rol) cargo = credito.miembro.rol.toUpperCase();

                tablaSolidariosTbody += `
                <tr>
                    <td align="center" style="font-weight:bold;">${index + 1}</td>
                    <td align="center" style="font-size:9px; font-weight:bold;">${cargo}</td>
                    <td align="center" style="font-size:10px; font-weight:bold; text-transform:uppercase;">${nombreCliente}</td>
            `;
                let totalSolidarios = 0;
                const contributorId = credito.miembro ? credito.miembro._id.toString() : null;

                for (let w = 1; w <= maxSemanas; w++) {
                    let label = esRefill ? w + 8 : w;
                    let bgStyle = (label >= 14) ? 'background-color: #dbe5f1;' : '';
                    let valorCelda = '';
                    if (llena && contributorId) {
                        let montoAportadoPorElMiembro = 0;

                        for (const otroCredito of creditosSubGrupo) {
                            if (otroCredito.pagos) {
                                const pagosSolSemana = otroCredito.pagos.filter(p => p.numeroPago === w && p.pagoSolidario === true);
                                for (const pSol of pagosSolSemana) {
                                    if (pSol.quienPrestoSolidario && pSol.quienPrestoSolidario.toString() === contributorId) {
                                        montoAportadoPorElMiembro += pSol.montoPagado;
                                    }
                                }
                            }
                        }

                        if (montoAportadoPorElMiembro > 0) {
                            valorCelda = `${formatoMoneda(montoAportadoPorElMiembro)}`;
                            totalSolidarios += montoAportadoPorElMiembro;
                        }
                    }
                    tablaSolidariosTbody += `<td align="center" style="${bgStyle} font-size:10px; font-weight:bold; color: #d97706;">${valorCelda}</td>`;
                }
                let textTotalSol = llena && totalSolidarios > 0 ? `${formatoMoneda(totalSolidarios)}` : '$ ';
                tablaSolidariosTbody += `<td align="left" style="font-weight:bold; font-size:10px;">${textTotalSol}</td></tr>`;
            });

            // Total Solidarios
            tablaSolidariosTbody += `
            <tr>
                <td colspan="3" align="right" style="font-weight:bold; padding-right:10px; padding: 5px 0;">TOTAL</td>
        `;
            for (let w = 1; w <= maxSemanas; w++) {
                let label = esRefill ? w + 8 : w;
                let bgStyle = (label >= 14) ? 'background-color: #dbe5f1;' : '';
                tablaSolidariosTbody += `<td align="left" style="${bgStyle} font-weight:bold; font-size:10px;">$ </td>`;
            }
            tablaSolidariosTbody += `<td align="left" style="font-weight:bold; font-size:10px;">$ </td></tr>`;

            // 5. TEMPLATE FINAL Y PDF



            const claveGrupo = grupo?.clave || "________________";

            // REEMPLAZAR VARIABLES
            let seccionBody = bodyTemplate
                .replace('{{grupoNombre}}', grupoNombre)
                .replace('{{diaVisita}}', diaVisita)
                .replace('{{clave}}', claveGrupo)
                .replace('{{horaVisita}}', horaVisita)
                .replace('{{ciclo}}', ciclo)
                .replace('{{tablaThead}}', tablaThead)
                .replace('{{tablaTbody}}', tablaTbody)
                .replace('{{tablaIncrementoThead}}', tablaIncrementoThead)
                .replace('{{tablaIncrementoTbody}}', tablaIncrementoTbody)
                .replace('{{tablaSolidariosThead}}', tablaSolidariosThead)
                .replace('{{tablaSolidariosTbody}}', tablaSolidariosTbody);

            finalBodies.push(seccionBody);
        }

        let htmlCompleto = htmlCompletoOrigin.replace(/<body[^>]*>[\s\S]*?<\/body>/i, '<body>' + finalBodies.join('<div style="page-break-before: always;"></div>') + '</body>');

        if (req.query.format === 'html') {
            return res.send(htmlCompleto);
        }

        const browser = await getBrowser();

        const page = await browser.newPage();
        await page.setContent(htmlCompleto, { waitUntil: "load" });

        const pdfBuffer = await page.pdf({
            format: "A4",
            landscape: true,
            printBackground: true,
            margin: { top: '20mm', bottom: '15mm', left: '10mm', right: '10mm' }
        });

        await page.close();

        res.setHeader('Content-Type', 'application/pdf');
        const grupoG = creditos[0]?.miembro?.grupo;
        const nombreG = grupoG?.nombre || "INDIVIDUAL";
        const nombreArchivo = nombreG.replace(/\D/g, '').length === 0 ? nombreG.replace(/[^a-zA-Z0-9]/g, '_') : nombreG.replace(/\s+/g, '_');
        res.setHeader('Content-Disposition', `attachment; filename="hoja-control_${nombreArchivo}_ciclo_${ciclo}.pdf"`);
        res.send(pdfBuffer);

    } catch (error) {
        console.error("Error generando hoja de control:", error);
        res.status(500).json({
            message: "Error interno",
            error: error.message
        });
    }
};

exports.generarHojaControlIndividual = async (req, res) => {
    const { clienteId, ciclo } = req.params;

    try {
        let creditos = await Credito.find({ cliente: clienteId })
            .populate({
                path: 'cliente',
                populate: { path: 'asesor' }
            })
            .populate('miembro')
            .sort({ createdAt: -1 });

        let credito = creditos.find(c => c.ciclo == ciclo);

        if (!credito && creditos.length > 0) {
            // Fallback si la BD no guardo el ciclo
            credito = creditos[0];
        }

        if (!credito) {
            return res.status(404).json({ message: "No se encontró el crédito para este cliente" });
        }

        const formatoMoneda = (num) =>
            Number(num).toLocaleString('es-MX', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });

        const generarCalendario = (fechaInicio, semanas) => {
            const fechas = [];
            let currentSaldo = credito.saldoTotal;
            const pagoPactado = credito.pagoPactado || 0;
            const llena = req.query.llena === 'true';

            const baseDate = new Date(fechaInicio);

            // Ajustar fecha base
            baseDate.setMinutes(baseDate.getMinutes() + baseDate.getTimezoneOffset());

            const frecuencia = (credito.frecuenciaPago || "Semanal").toLowerCase();

            for (let i = 0; i < semanas; i++) {
                let nueva;
                if (frecuencia === 'mensual') {
                    const temp = new Date(baseDate);
                    const targetDay = temp.getDate();
                    temp.setMonth(temp.getMonth() + i);
                    if (temp.getDate() !== targetDay) { temp.setDate(0); }
                    nueva = temp;
                } else if (frecuencia === 'quincenal') {
                    nueva = new Date(baseDate);
                    nueva.setDate(baseDate.getDate() + (i * 15));
                } else if (frecuencia === 'bisemanal') {
                    nueva = new Date(baseDate);
                    nueva.setDate(baseDate.getDate() + (i * 14));
                } else {
                    nueva = new Date(baseDate);
                    nueva.setDate(baseDate.getDate() + (i * 7));
                }

                const fechaStr = nueva.toLocaleDateString('es-MX', {
                    day: '2-digit', month: '2-digit', year: 'numeric'
                });

                let pagoReal = 0;
                let foundPayment = false;
                if (credito.pagos) {
                    const pagosSemana = credito.pagos.filter(p => p.numeroPago === i + 1);
                    if (pagosSemana.length > 0) {
                        pagoReal = pagosSemana.reduce((acc, p) => acc + p.montoPagado, 0);
                        foundPayment = true;
                    }
                }

                const saldoInicialRow = currentSaldo;
                // Si está llena, restar el pago real (si existe). Si no, restar el pactado para el plan teórico.
                const pagoParaSaldo = llena ? (foundPayment ? pagoReal : 0) : pagoPactado;
                const saldoFinalRow = saldoInicialRow - pagoParaSaldo > 0 ? saldoInicialRow - pagoParaSaldo : 0;

                fechas.push({
                    numero: credito.tipoCredito === 'R' ? i + 9 : i + 1,
                    fecha: fechaStr,
                    saldoInicial: saldoInicialRow,
                    pago: (llena && foundPayment) ? pagoReal : (llena ? 0 : pagoPactado),
                    saldoFinal: saldoFinalRow,
                    llena: llena,
                    found: foundPayment
                });

                currentSaldo = saldoFinalRow;
            }
            return fechas;
        };

        const maxSemanas = credito.semanas || 16;
        const fechaBasica = credito.fechaPrimerPago || new Date();
        const amortizaciones = generarCalendario(fechaBasica, maxSemanas);

        let tablaAmortizacionTbody = '';
        amortizaciones.forEach(row => {
            const si = row.llena ? ((row.found || row.numero === 1) ? formatoMoneda(row.saldoInicial) : '') : '';
            const p = row.llena ? (row.found ? formatoMoneda(row.pago) : '') : '';
            const sf = row.llena ? (row.found ? formatoMoneda(row.saldoFinal) : '') : '';

            tablaAmortizacionTbody += `
                <tr>
                    <td align="center" style="font-weight:bold;">${row.numero}</td>
                    <td align="center" style="font-weight:bold;">${row.fecha}</td>
                    <td style="font-weight:bold;"><div class="align-money"><span>$</span> <span>${si}</span></div></td>
                    <td style="font-weight:bold;"><div class="align-money"><span>$</span> <span>${p}</span></div></td>
                    <td style="font-weight:bold;"><div class="align-money"><span>$</span> <span>${sf}</span></div></td>
                </tr>
            `;
        });

        // Obtener datos cabecera
        const nombreCliente = credito.cliente
            ? (credito.cliente.nombre + (credito.cliente.apellidos ? ` ${credito.cliente.apellidos}` : ""))
            : credito.miembro
                ? (credito.miembro.nombre + (credito.miembro.apellidos ? ` ${credito.miembro.apellidos}` : ""))
                : "N/A";

        const saldoInicial = formatoMoneda(credito.saldoTotal || 0);
        const garantia = formatoMoneda(credito.garantia || 0);
        const pagoPactado = formatoMoneda(credito.pagoPactado || 0);
        const periodoPago = (credito.frecuenciaPago || "SEMANAL").toUpperCase();

        let grupoOpcionalHtml = '';
        if (credito.grupoOpcional && credito.grupoOpcional.trim() !== '') {
            grupoOpcionalHtml = `
                <div style="display: flex; margin-bottom: 5px;">
                    <div style="width: 150px; text-align: right; padding-right: 10px;">GRUPO:</div>
                    <div style="font-weight: normal; text-transform: uppercase;">${credito.grupoOpcional}</div>
                </div>`;
        }

        let garantiaPredialHtml = '';
        if (credito.garantiaPredial && credito.garantiaPredial.trim() !== '') {
            garantiaPredialHtml = `
                <div style="display: flex; margin-bottom: 5px;">
                    <div style="width: 150px; text-align: right; padding-right: 10px;">GTIA PREDIAL/HIPOT:</div>
                    <div style="font-weight: normal; text-transform: uppercase;">${credito.garantiaPredial}</div>
                </div>`;
        }

        // Obtener el día de la semana de fechaBasica
        const diasSemana = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];
        const baseDate = new Date(fechaBasica);
        baseDate.setMinutes(baseDate.getMinutes() + baseDate.getTimezoneOffset());
        const diaPago = diasSemana[baseDate.getDay()];

        const asesorStr = credito.cliente && credito.cliente.asesor
            ? (credito.cliente.asesor.nombre || credito.cliente.asesor.username || "________________")
            : "________________";
        const asesorNombre = asesorStr.toUpperCase();

        const templatePath = path.join(__dirname, '../templates/hojaControlIndividual.html');
        let htmlCompleto = fs.readFileSync(templatePath, 'utf8');

        htmlCompleto = htmlCompleto
            .replace('{{clienteNombre}}', nombreCliente)
            .replace('{{grupoOpcionalHtml}}', grupoOpcionalHtml)
            .replace('{{garantiaPredialHtml}}', garantiaPredialHtml)
            .replace('{{ciclo}}', ciclo)
            .replace('{{saldoInicial}}', saldoInicial)
            .replace('{{garantia}}', garantia)
            .replace('{{periodoPago}}', periodoPago)
            .replace('{{numPagos}}', maxSemanas)
            .replace('{{diaPago}}', diaPago)
            .replace('{{pagoPactado}}', pagoPactado)
            .replace('{{asesorNombre}}', asesorNombre)
            .replace('{{tablaAmortizacionTbody}}', tablaAmortizacionTbody);

        if (req.query.format === 'html') {
            return res.send(htmlCompleto);
        }

        const browser = await getBrowser();

        const page = await browser.newPage();
        await page.setContent(htmlCompleto, { waitUntil: "load" });

        const pdfBuffer = await page.pdf({
            format: "A4",
            landscape: false,
            printBackground: true,
            margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' }
        });

        await page.close();

        res.setHeader('Content-Type', 'application/pdf');
        const nombreArchivo = nombreCliente.replace(/\D/g, '').length === 0 ? nombreCliente.replace(/[^a-zA-Z0-9]/g, '_') : nombreCliente.replace(/\s+/g, '_');
        res.setHeader('Content-Disposition', `attachment; filename="hoja-control-ind_${nombreArchivo}_ciclo_${ciclo}.pdf"`);
        res.send(pdfBuffer);

    } catch (error) {
        console.error("Error generando hoja de control individual:", error);
        res.status(500).json({
            message: "Error interno",
            error: error.message
        });
    }
};

