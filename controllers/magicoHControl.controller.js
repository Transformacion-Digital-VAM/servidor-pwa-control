const mongoose = require('mongoose');
const CreditoMagico = require('../models/CreditoMagico');
const Grupo = require('../models/Grupo');
const { logError } = require('../utils/loggers');

/**
 * Formatea un número como moneda sin signo de pesos (ej. 375.00 o 6,000.00)
 */
function formatoMoneda(valor) {
    const num = Number(valor) || 0;
    return num.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

/**
 * Formatea una fecha a DD/MM/YYYY en UTC
 */
function formatearFechaDDMMYYYY(fecha) {
    if (!fecha) return '';
    const d = new Date(fecha);
    if (isNaN(d.getTime())) return '';
    const dia = String(d.getUTCDate()).padStart(2, '0');
    const mes = String(d.getUTCMonth() + 1).padStart(2, '0');
    const anio = d.getUTCFullYear();
    return `${dia}/${mes}/${anio}`;
}

/**
 * Genera la Hoja de Control de Mágicos en HTML para visualización directa en vista previa
 * GET /api/magicos/hoja-control/:grupoId
 */
exports.generarHojaControlMagicos = async (req, res) => {
    try {
        const { grupoId } = req.params;
        const incluirLiquidados = req.query.incluirLiquidados === 'true';
        const tipoHoja = (req.query.tipo || 'llena').toLowerCase(); // 'llena' o 'vacia'

        if (!mongoose.Types.ObjectId.isValid(grupoId)) {
            return res.status(400).send(`
                <html>
                <body style="font-family: Arial, sans-serif; padding: 30px; text-align: center; color: #b91c1c;">
                    <h2>ID de grupo inválido</h2>
                </body>
                </html>
            `);
        }

        const grupo = await Grupo.findById(grupoId)
            .populate('asesor', 'nombre username')
            .populate('coordinacion', 'nombre municipio')
            .lean();

        if (!grupo) {
            return res.status(404).send(`
                <html>
                <body style="font-family: Arial, sans-serif; padding: 30px; text-align: center; color: #b91c1c;">
                    <h2>Grupo no encontrado</h2>
                </body>
                </html>
            `);
        }

        const filtroEstado = incluirLiquidados ? { $ne: 'Cancelado' } : 'Activo';

        const creditos = await CreditoMagico.find({
            grupo: grupoId,
            estado: filtroEstado
        })
            .populate('miembro', 'nombre apellidos rol')
            .populate('asesor', 'nombre username')
            .sort({ createdAt: 1 })
            .lean();

        if (!creditos || creditos.length === 0) {
            return res.status(200).send(`
                <!DOCTYPE html>
                <html lang="es">
                <head>
                    <meta charset="UTF-8">
                    <title>Hoja de Control Mágicos - Sin Créditos</title>
                    <style>
                        body { font-family: Arial, sans-serif; padding: 40px; text-align: center; color: #475569; }
                        .card { border: 1px solid #cbd5e1; border-radius: 12px; padding: 30px; display: inline-block; max-width: 500px; }
                        h2 { color: #1e293b; margin-top: 0; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <h2>HOJA DE CONTROL MÁGICOS</h2>
                        <p><strong>Grupo:</strong> ${grupo.nombre || 'S/N'}</p>
                        <p>No se encontraron créditos mágicos ${incluirLiquidados ? 'registrados' : 'activos'} para este grupo.</p>
                    </div>
                </body>
                </html>
            `);
        }

        const logoUrl = "https://static.wixstatic.com/media/0bf950_155f8cd81f6d4fe5ac3419b8e0397b40~mv2.png/v1/crop/x_0,y_260,w_6000,h_2480/fill/w_508,h_210,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/LOGO%20SIN%20FONDO%20OFICIAL.png";

        const nombreGrupo = (grupo.nombre || 'GRUPO').toUpperCase();
        const responsableNombre = (
            grupo.asesor?.nombre ||
            grupo.asesor?.username ||
            creditos[0]?.asesor?.nombre ||
            creditos[0]?.asesor?.username ||
            ''
        ).toUpperCase();

        // Construir cada tabla por miembro
        let tablasMiembrosHtml = '';

        creditos.forEach((c) => {
            const nombreCliente = (
                c.miembro ? `${c.miembro.nombre || ''} ${c.miembro.apellidos || ''}` : 'INTEGRANTE'
            ).trim().toUpperCase();

            const semanasTotal = Number(c.semanas) || 16;
            const pagoSemanal = Number(c.pagoPactado) || 0;
            const saldoInicial = Number(c.saldoTotal) || (pagoSemanal * semanasTotal);

            // Generar fechas semanales desfasadas para este miembro
            const baseFecha = c.fechaPrimerPago ? new Date(c.fechaPrimerPago) : new Date();
            const calendarioFechas = [];
            for (let sem = 1; sem <= semanasTotal; sem++) {
                const d = new Date(baseFecha);
                d.setUTCDate(d.getUTCDate() + (sem - 1) * 7);
                calendarioFechas.push(formatearFechaDDMMYYYY(d));
            }

            // Construir encabezados SEM 1 ... SEM 16
            let thSemanasHtml = '';
            for (let sem = 1; sem <= semanasTotal; sem++) {
                thSemanasHtml += `<th class="th-sem">SEM ${sem}</th>`;
            }

            // Construir fechas bajo SEM 1 ... SEM 16
            let thFechasHtml = '';
            for (let sem = 0; sem < semanasTotal; sem++) {
                thFechasHtml += `<th class="th-fecha">${calendarioFechas[sem]}</th>`;
            }

            // Fila 3: PAGO SEMANAL (Sem 1 tiene $pagoSemanal, resto según pagos o celdas para registrar)
            let celdasPagosHtml = '';
            const pagosExistentes = Array.isArray(c.pagos) ? c.pagos : [];

            let saldoAcumulado = saldoInicial;
            const saldosSemanales = [];

            for (let sem = 1; sem <= semanasTotal; sem++) {
                const pagosDeSemana = pagosExistentes.filter(p => Number(p.numeroPago) === sem);
                const totalPagadoSem = pagosDeSemana.reduce((sum, p) => sum + (Number(p.montoPagado) || 0), 0);

                if (tipoHoja === 'vacia') {
                    // Formato base limpio según la plantilla: Sem 1 muestra $pagoSemanal, resto vacío
                    if (sem === 1) {
                        celdasPagosHtml += `<td class="td-monto">$${formatoMoneda(pagoSemanal)}</td>`;
                    } else {
                        celdasPagosHtml += `<td class="td-grid">&nbsp;</td>`;
                    }
                    saldosSemanales.push('&nbsp;');
                } else {
                    // Formato para consulta/seguimiento con avance de pagos
                    if (totalPagadoSem > 0) {
                        celdasPagosHtml += `<td class="td-monto td-pagado">$${formatoMoneda(totalPagadoSem)}</td>`;
                        saldoAcumulado = Math.max(0, saldoAcumulado - totalPagadoSem);
                        saldosSemanales.push(`$${formatoMoneda(saldoAcumulado)}`);
                    } else if (sem === 1) {
                        celdasPagosHtml += `<td class="td-monto">$${formatoMoneda(pagoSemanal)}</td>`;
                        saldosSemanales.push('&nbsp;');
                    } else {
                        celdasPagosHtml += `<td class="td-grid">&nbsp;</td>`;
                        saldosSemanales.push('&nbsp;');
                    }
                }
            }

            // Fila 4: celdas de saldo semanal bajo cada SEM 1 ... SEM 16
            let celdasSaldosHtml = '';
            for (let sem = 0; sem < semanasTotal; sem++) {
                const valSaldo = saldosSemanales[sem] || '&nbsp;';
                if (valSaldo !== '&nbsp;') {
                    celdasSaldosHtml += `<td class="td-monto td-saldo-val">${valSaldo}</td>`;
                } else {
                    celdasSaldosHtml += `<td class="td-grid">&nbsp;</td>`;
                }
            }

            // Saldo final
            let saldoFinalTexto = '&nbsp;';
            if (tipoHoja !== 'vacia') {
                if (c.estado === 'Liquidado') {
                    saldoFinalTexto = '$0.00';
                } else if (c.saldoPendiente !== undefined && c.saldoPendiente !== null) {
                    saldoFinalTexto = `$${formatoMoneda(c.saldoPendiente)}`;
                }
            }

            tablasMiembrosHtml += `
            <div class="bloque-tabla-miembro">
                <table class="tabla-magico">
                    <thead>
                        <tr>
                            <th class="th-cliente" rowspan="2">NOMBRE DEL CLIENTE</th>
                            <th class="th-semana-label">SEMANA</th>
                            ${thSemanasHtml}
                            <th class="th-saldo-final" rowspan="2">SALDO<br>FINAL</th>
                        </tr>
                        <tr>
                            <th class="th-fecha-label">FECHA</th>
                            ${thFechasHtml}
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td class="td-cliente">${nombreCliente}</td>
                            <td class="td-pago-label">PAGO<br>SEMANAL</td>
                            ${celdasPagosHtml}
                            <td class="td-grid td-sf-val">${saldoFinalTexto}</td>
                        </tr>
                        <tr>
                            <td class="td-saldo-label">SALDO INICIAL</td>
                            <td class="td-monto td-saldo-inicial-valor">$${formatoMoneda(saldoInicial)}</td>
                            ${celdasSaldosHtml}
                            <td class="td-grid td-sf-val">&nbsp;</td>
                        </tr>
                    </tbody>
                </table>
            </div>
            `;
        });

        const htmlCompleto = `
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Hoja de Control Mágicos - ${nombreGrupo}</title>
            <style>
                @page {
                    size: landscape;
                    margin: 8mm 6mm;
                }
                * {
                    box-sizing: border-box;
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
                }
                body {
                    margin: 0;
                    padding: 14px 18px;
                    font-family: Arial, Helvetica, sans-serif;
                    background-color: #ffffff;
                    color: #000000;
                    font-size: 10px;
                }

                /* Barra superior de herramientas (oculta al imprimir) */
                .barra-acciones {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    background: #f8fafc;
                    border: 1px solid #cbd5e1;
                    padding: 8px 14px;
                    border-radius: 8px;
                    margin-bottom: 12px;
                }
                .barra-acciones .titulo-barra {
                    font-size: 12px;
                    font-weight: bold;
                    color: #334155;
                }
                .btn-accion {
                    background-color: #7c3aed;
                    color: #ffffff;
                    border: none;
                    border-radius: 6px;
                    padding: 6px 14px;
                    font-size: 11px;
                    font-weight: bold;
                    cursor: pointer;
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    transition: background-color 0.15s ease;
                }
                .btn-accion:hover {
                    background-color: #6d28d9;
                }
                .btn-secundario {
                    background-color: #ffffff;
                    color: #475569;
                    border: 1px solid #cbd5e1;
                    margin-left: 8px;
                }
                .btn-secundario:hover {
                    background-color: #f1f5f9;
                }

                /* Encabezado superior del documento */
                .header-hoja {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    position: relative;
                    margin-bottom: 8px;
                }
                .logo-container {
                    width: 200px;
                    text-align: left;
                }
                .logo-container img {
                    height: 38px;
                    max-width: 190px;
                    object-fit: contain;
                }
                .titulo-hoja-container {
                    flex: 1;
                    text-align: center;
                }
                .titulo-hoja {
                    margin: 0;
                    font-size: 16px;
                    font-weight: 900;
                    letter-spacing: 0.5px;
                    text-transform: uppercase;
                }
                .spacer-derecha {
                    width: 200px;
                }

                /* Datos del Grupo y Responsable */
                .datos-grupo {
                    margin-bottom: 10px;
                    font-size: 11px;
                    font-weight: bold;
                    line-height: 1.5;
                }
                .fila-dato {
                    display: flex;
                    align-items: baseline;
                }
                .label-dato {
                    display: inline-block;
                    width: 115px;
                    font-weight: 900;
                }
                .valor-dato {
                    font-weight: bold;
                    text-transform: uppercase;
                }

                /* Estructura de las tablas */
                .bloque-tabla-miembro {
                    margin-bottom: 12px;
                    page-break-inside: avoid;
                }
                table.tabla-magico {
                    width: 100%;
                    border-collapse: collapse;
                    table-layout: fixed;
                    border: 1.5px solid #000000;
                }
                table.tabla-magico th,
                table.tabla-magico td {
                    border: 1px solid #000000;
                    text-align: center;
                    vertical-align: middle;
                    padding: 3px 1px;
                }

                /* Columnas */
                .th-cliente,
                .td-cliente,
                .td-saldo-label {
                    width: 16.5%;
                    font-size: 10px;
                    font-weight: bold;
                    text-transform: uppercase;
                    padding: 4px 5px;
                    line-height: 1.15;
                }
                .td-cliente {
                    text-align: center;
                }
                .th-semana-label,
                .th-fecha-label,
                .td-pago-label,
                .td-saldo-inicial-valor {
                    width: 6.5%;
                    font-size: 8.5px;
                    font-weight: bold;
                    line-height: 1.1;
                    text-align: center;
                }
                .td-saldo-label {
                    font-size: 9.5px;
                    font-weight: bold;
                    text-align: center;
                    letter-spacing: 0.5px;
                }

                .th-sem {
                    width: 4.45%;
                    font-size: 8.5px;
                    font-weight: bold;
                    background-color: #ffffff;
                }
                .th-fecha {
                    width: 4.45%;
                    font-size: 7.5px;
                    font-weight: normal;
                    white-space: nowrap;
                    background-color: #ffffff;
                }

                .td-monto {
                    font-size: 9.5px;
                    font-weight: bold;
                    font-family: Arial, sans-serif;
                }
                .td-pagado {
                    color: #000000;
                }
                .td-saldo-val {
                    color: #000000;
                }
                .td-grid {
                    background-color: #ffffff;
                }

                .th-saldo-final {
                    width: 4.8%;
                    font-size: 8.5px;
                    font-weight: bold;
                    line-height: 1.1;
                }
                .td-sf-val {
                    font-size: 9.5px;
                    font-weight: bold;
                }

                @media print {
                    .barra-acciones {
                        display: none !important;
                    }
                    body {
                        padding: 0;
                    }
                    .bloque-tabla-miembro {
                        page-break-inside: avoid;
                    }
                }
            </style>
        </head>
        <body>

            <div class="barra-acciones">
                <span class="titulo-barra">Vista Previa - Hoja de Control Mágicos: <strong>${nombreGrupo}</strong></span>
                <div>
                    <button type="button" class="btn-accion" onclick="window.print()">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="6 9 6 2 18 2 18 9"></polyline>
                            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                            <rect x="6" y="14" width="12" height="8"></rect>
                        </svg>
                        Imprimir / Guardar PDF
                    </button>
                    <button type="button" class="btn-accion btn-secundario" onclick="window.close()">Cerrar</button>
                </div>
            </div>

            <div class="header-hoja">
                <div class="logo-container">
                    <img src="${logoUrl}" alt="Vamos a Mejorar">
                </div>
                <div class="titulo-hoja-container">
                    <h1 class="titulo-hoja">HOJA DE CONTROL MÁGICOS</h1>
                </div>
                <div class="spacer-derecha"></div>
            </div>

            <div class="datos-grupo">
                <div class="fila-dato">
                    <span class="label-dato">GRUPO:</span>
                    <span class="valor-dato">${nombreGrupo}</span>
                </div>
                <div class="fila-dato">
                    <span class="label-dato">RESPONSABLE:</span>
                    <span class="valor-dato">${responsableNombre}</span>
                </div>
            </div>

            ${tablasMiembrosHtml}

        </body>
        </html>
        `;

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(htmlCompleto);

    } catch (error) {
        logError(req, 'GENERAR_HOJA_MAGICOS_ERROR', error, { grupoId: req.params.grupoId });
        console.error('Error generando hoja de control mágicos:', error);
        return res.status(500).send(`
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <title>Error</title>
                <style>body { font-family: Arial, sans-serif; padding: 30px; text-align: center; color: #dc2626; }</style>
            </head>
            <body>
                <h2>Error al generar la Hoja de Control Mágicos</h2>
                <p>${error.message}</p>
            </body>
            </html>
        `);
    }
};
